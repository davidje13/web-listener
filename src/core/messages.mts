import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { MaybePromise } from '../util/MaybePromise.mts';
import { internalParseURL } from '../util/parseURL.mts';
import { ErrorAccumulator } from '../util/ErrorAccumulator.mts';
import type { UpgradeErrorHandler } from './errorHandler.mts';

export type TeardownFn = () => MaybePromise<void>;

interface RequestOutput {
  _target: ServerResponse;
}

interface UpgradeOutput {
  _target: Duplex;
  _head: Buffer;
}

interface RequestExtraProps {
  _upgradeProtocols: null;
  _output?: RequestOutput;
}

interface UpgradeExtraProps {
  _upgradeProtocols: Set<string>;
  _output?: UpgradeOutput;
}

export type MessageProps = {
  _request: IncomingMessage;
  _originalURL: URL;
  _decodedPathname: string;
  _shouldUpgradeErrorHandler?: (error: unknown) => void;
  _upgradeErrorHandler?: UpgradeErrorHandler;
  _ac: AbortController;
  _deferred: TeardownFn[];
  _teardowns: TeardownFn[];
  _postTeardown?: (fn: () => MaybePromise<void>) => void;
  _running?: Promise<void> | undefined;
} & (RequestExtraProps | UpgradeExtraProps);

const REQUESTS = new WeakMap<IncomingMessage, MessageProps>();

export function internalBeginRequest(req: IncomingMessage, isUpgrade: boolean): MessageProps {
  const existingProps = REQUESTS.get(req);
  if (existingProps) {
    // Nested request (ideally should not happen), or request/upgrade after shouldUpgrade - just return the already generated props.
    return existingProps;
  }

  const url = internalParseURL(req);
  const props: MessageProps = {
    _request: req,
    _originalURL: url,
    _decodedPathname: decodeURIComponent(url.pathname), // must decode URI upfront to avoid path confusion vulnerabilities
    _ac: new AbortController(),
    _deferred: [],
    _teardowns: [],
    _upgradeProtocols: isUpgrade ? internalReadUpgradeProtocols(req) : null,
  };
  REQUESTS.set(req, props);
  return props;
}

export function internalBeginResponse(
  props: MessageProps,
  isUpgrade: boolean,
  output: RequestOutput | UpgradeOutput,
  onTeardownError: (error: unknown, req: IncomingMessage) => void,
): MessageProps {
  if (!isUpgrade) {
    // may switch upgrade -> request if shouldUpgrade returned false (never switches request -> upgrade)
    props._upgradeProtocols = null;
  }
  props._output = output;

  const handleClose = async () => {
    // finished sending response, or client aborted request (can check _target.writableEnded to distinguish if needed)
    props._ac.abort(output._target.writableEnded ? 'complete' : 'client abort');
    const err = new ErrorAccumulator();
    await internalRunTeardown(props._deferred, err, props);
    await internalRunTeardown(props._teardowns, err, props, () => {
      props._postTeardown = async (fn) => {
        try {
          await fn();
        } catch (error: unknown) {
          onTeardownError(error, props._request);
        }
      };
    });
    if (err._hasError) {
      onTeardownError(err._error, props._request);
    }
  };

  if (output._target.closed) {
    handleClose();
  } else {
    output._target.once('close', handleClose);
  }

  return props;
}

export const internalRunDeferred = (props: MessageProps, errorState: ErrorAccumulator) =>
  internalRunTeardown(props._deferred, errorState, props);

async function internalRunTeardown(
  tasks: TeardownFn[],
  errorState: ErrorAccumulator,
  props: MessageProps,
  syncOnComplete?: () => void,
) {
  while (props._running) {
    await props._running;
  }
  const task = (async () => {
    while (true) {
      const task = tasks.pop();
      if (!task) {
        syncOnComplete?.();
        return;
      }
      try {
        await task();
      } catch (error: unknown) {
        errorState._add(error);
      }
    }
  })().then(() => {
    if (props._running === task) {
      props._running = undefined;
    }
  });
  props._running = task;
  await task;
}

function internalReadUpgradeProtocols(req: IncomingMessage) {
  return new Set(req.headers.upgrade?.split(',').map((v) => v.trim().toLowerCase()) ?? []);
}

// These two methods are the only internals needed by the extras
// (external things can use Property / makeMemo instead, but this direct access is fractionally faster)

export const internalGetProps = <T = {},>(req: IncomingMessage) =>
  REQUESTS.get(req) as (MessageProps & Partial<T>) | undefined;

export function internalMustGetProps<T = {}>(req: IncomingMessage) {
  const props = internalGetProps<T>(req);
  if (!props) {
    throw new RangeError('unknown request');
  }
  return props;
}
