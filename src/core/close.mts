import type { IncomingMessage } from 'node:http';
import type { MaybePromise } from '../util/MaybePromise.mts';
import { internalGetProps, internalMustGetProps, type MessageProps } from './messages.mts';
import { internalLogError, type ServerErrorCallback } from './errorHandler.mts';

export type SoftCloseHandler = (reason: string) => MaybePromise<void>;

interface SoftCloseDetails {
  _reason: string;
  _errorCallback: ServerErrorCallback;
}

interface CloseMessageProps {
  _hardCloseScheduledTime: number;
  _softCloseSchedule: SoftCloseDetails & { _time: number };
  _softCloseHandler: SoftCloseHandler;
  _isSoftClosed: SoftCloseDetails;
  _checkCloseTimeout: NodeJS.Timeout | undefined;
}

export function setSoftCloseHandler(req: IncomingMessage, fn: SoftCloseHandler) {
  const props = internalGetProps<CloseMessageProps>(req);
  if (props) {
    internalSetSoftCloseHandler(props, fn);
  }
}

export function internalSetSoftCloseHandler(
  props: MessageProps & Partial<CloseMessageProps>,
  fn: SoftCloseHandler,
) {
  props._softCloseHandler = fn;
  const details = props._isSoftClosed;
  if (details) {
    queueMicrotask(() => internalRunSoftCloseHandler(fn, props._request, details));
  }
}

export const isSoftClosed = (req: IncomingMessage) =>
  Boolean(internalGetProps<CloseMessageProps>(req)?._isSoftClosed);

export function scheduleClose(
  req: IncomingMessage,
  reason: string,
  hardCloseTimestamp: number,
  softCloseBufferTime: number = 0,
  onSoftCloseError: ServerErrorCallback = internalLogError,
) {
  const props = internalMustGetProps<CloseMessageProps>(req);
  const softCloseTimestamp = hardCloseTimestamp - Math.max(softCloseBufferTime, 0);
  const existingHardClose = props._hardCloseScheduledTime ?? Number.POSITIVE_INFINITY;
  const existingSoftClose = props._softCloseSchedule?._time ?? existingHardClose;

  if (softCloseTimestamp >= existingSoftClose && hardCloseTimestamp >= existingHardClose) {
    return;
  }

  if (hardCloseTimestamp < existingHardClose) {
    props._hardCloseScheduledTime = hardCloseTimestamp;
  }
  if (softCloseTimestamp < existingSoftClose) {
    props._softCloseSchedule = {
      _time: softCloseTimestamp,
      _reason: reason,
      _errorCallback: onSoftCloseError,
    };
  }
  internalUpdateCloseTimeout(props);
}

export function internalSoftClose(
  props: MessageProps & Partial<CloseMessageProps>,
  reason: string,
  onError: ServerErrorCallback,
) {
  if (props._isSoftClosed) {
    return;
  }
  if (props._output && !props._upgradeProtocols) {
    const res = props._output._target;
    if (!res.headersSent && !res.hasHeader('connection')) {
      res.setHeader('connection', 'close');
    }
  }
  props._output?._target.once('close', () => props._request.socket.destroy());
  props._isSoftClosed = { _reason: reason, _errorCallback: onError };
  void internalRunSoftCloseHandler(props._softCloseHandler, props._request, props._isSoftClosed);
  internalUpdateCloseTimeout(props);
}

export function internalHardClose(props: MessageProps & Partial<CloseMessageProps>) {
  if (!props._output) {
    props._request.socket.destroy();
    return;
  }
  if (!props._upgradeProtocols) {
    const res = props._output._target;
    if (!res.headersSent) {
      res.statusCode = 503;
      if (!res.hasHeader('connection')) {
        res.setHeader('connection', 'close');
      }
    }
  }
  props._output._target.end(() => props._request.socket.destroy());
}

function internalUpdateCloseTimeout(props: MessageProps & Partial<CloseMessageProps>) {
  clearTimeout(props._checkCloseTimeout);
  if (!props._hardCloseScheduledTime || props._postTeardown) {
    return;
  }
  const now = Date.now();
  if (now >= props._hardCloseScheduledTime) {
    internalHardClose(props);
    return;
  }
  let next = props._hardCloseScheduledTime;
  if (props._softCloseSchedule && !props._isSoftClosed) {
    if (now < props._softCloseSchedule._time) {
      next = props._softCloseSchedule._time;
    } else {
      props._isSoftClosed = props._softCloseSchedule;
      void internalRunSoftCloseHandler(
        props._softCloseHandler,
        props._request,
        props._isSoftClosed,
      );
    }
  }
  if (props._checkCloseTimeout === undefined) {
    props._teardowns.push(() => clearTimeout(props._checkCloseTimeout));
  }
  props._checkCloseTimeout = setTimeout(() => internalUpdateCloseTimeout(props), next - now);
}

async function internalRunSoftCloseHandler(
  handler: SoftCloseHandler | undefined,
  req: IncomingMessage,
  details: SoftCloseDetails,
) {
  try {
    await handler?.(details._reason);
  } catch (error: unknown) {
    details._errorCallback(error, 'soft closing', req);
  }
}

export const defer = (req: IncomingMessage, fn: () => MaybePromise<void>) => {
  const props = internalMustGetProps(req);
  if (props._postTeardown) {
    props._postTeardown(fn);
  } else {
    props._deferred.push(fn);
  }
};

export const addTeardown = (req: IncomingMessage, fn: () => MaybePromise<void>) => {
  const props = internalMustGetProps(req);
  if (props._postTeardown) {
    props._postTeardown(fn);
  } else {
    props._teardowns.push(fn);
  }
};

export const getAbortSignal = (req: IncomingMessage) => internalMustGetProps(req)._ac.signal;
