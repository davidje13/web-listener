import {
  ServerResponse,
  STATUS_CODES,
  type IncomingMessage,
  type RequestListener,
} from 'node:http';
import type {
  ClientErrorListener,
  ShouldUpgradeCallback,
  UpgradeListener,
} from '../polyfill/serverTypes.mts';
import { VOID_BUFFER } from '../util/voidBuffer.mts';
import { ErrorAccumulator } from '../util/ErrorAccumulator.mts';
import { findCause } from '../util/findCause.mts';
import { guardTimeout } from '../util/guardTimeout.mts';
import { internalCheckShouldUpgrade, internalRunHandler } from './Router.mts';
import type { Handler } from './handler.mts';
import {
  internalBeginRequest,
  internalBeginResponse,
  internalEndRequest,
  type MessageProps,
  type ServerErrorCallback,
} from './messages.mts';
import { CONTINUE, NEXT_ROUTE, NEXT_ROUTER } from './RoutingInstruction.mts';
import { HTTPError } from './HTTPError.mts';
import { internalDefaultErrorHandler } from './defaultErrorHandler.mts';
import { internalHardClose, internalSoftClose } from './close.mts';

export interface NativeListenersOptions {
  /**
   * Function to call when:
   * - a request or upgrade cannot be parsed; or
   * - a request or upgrade error reaches the end of the chain without being handled; or
   * - an error occurs during a teardown; or
   * - an error occurs in a shouldUpgrade function.
   *
   * The default implementation logs the error via `console.error` unless it is a `HTTPError` with `statusCode` < 500
   */
  onError?: ServerGeneralErrorCallback;

  /**
   * Number of milliseconds to wait before forcibly closing sockets which are left half-open by the client.
   * @default 500
   */
  socketCloseTimeout?: number;
}

export type ServerGeneralErrorCallback = (
  error: unknown,
  context: string,
  req: IncomingMessage | undefined,
) => void;

export interface NativeListeners {
  request: RequestListener;
  checkContinue: RequestListener;
  upgrade: UpgradeListener;
  shouldUpgrade: ShouldUpgradeCallback;
  clientError: ClientErrorListener;
  softClose(reason: string, onError: ServerErrorCallback, callback?: () => void): void;
  hardClose(callback?: () => void): void;
  countConnections(): number;
}

export function toListeners(
  handler: Handler,
  { onError = internalLogError, socketCloseTimeout = 500 }: NativeListenersOptions = {},
): NativeListeners {
  guardTimeout(socketCloseTimeout, 'socketCloseTimeout');

  let closeState = 0;
  let closeReason = '';
  let closeOnError: ServerErrorCallback = onError;

  const allClosedCallbacks: (() => void)[] = [];
  const active = new Set<MessageProps>();
  const runAllClosedCallbacks = () => {
    const callbacks = [...allClosedCallbacks];
    allClosedCallbacks.length = 0;
    for (const fn of callbacks) {
      fn();
    }
  };
  const addAllClosedCallback = (callback: (() => void) | undefined) => {
    if (callback) {
      if (active.size) {
        allClosedCallbacks.push(callback);
      } else {
        setImmediate(callback);
      }
    }
  };
  const track = (props: MessageProps) => {
    active.add(props);
    props._teardowns.push(() => {
      active.delete(props);
      if (!active.size && allClosedCallbacks.length) {
        setImmediate(runAllClosedCallbacks);
      }
    });
  };
  const handleRequest = async (
    req: IncomingMessage,
    res: ServerResponse,
    isCheckContinue: boolean,
  ) => {
    let props: MessageProps;
    try {
      props = internalBeginRequest(req, onError, false);
    } catch (error: unknown) {
      onError(error, 'parsing request', req);
      internalDefaultErrorHandler(new HTTPError(400), req, { response: res });
      return;
    }
    internalBeginResponse(props, false, { _target: res });
    if (isCheckContinue) {
      props._expectsContinue = true;
    }
    track(props);
    if (closeState === 1) {
      internalSoftClose(props, closeReason, closeOnError);
    } else if (closeState === 2) {
      internalHardClose(props);
      internalEndRequest(req);
      return;
    }
    const currentError = new ErrorAccumulator();
    const r = await internalRunHandler(handler, props, currentError);
    if (!currentError._hasError && (r === CONTINUE || r === NEXT_ROUTE || r === NEXT_ROUTER)) {
      currentError._add(new HTTPError(404));
    }
    if (currentError._hasError) {
      onError(currentError._error, 'handling request', req);
      internalDefaultErrorHandler(currentError._error, req, { response: res });
      internalEndRequest(req);
    }
  };

  return {
    request: (req, res) => handleRequest(req, res, false),
    checkContinue: (req, res) => handleRequest(req, res, true),

    upgrade: async (req, socket, head) => {
      socket.once('finish', () => {
        // do not allow half-open sockets to linger
        const tm = setTimeout(() => socket.destroy(), socketCloseTimeout);
        socket.once('close', () => clearTimeout(tm));
      });

      let props: MessageProps;
      try {
        props = internalBeginRequest(req, onError, true);
      } catch (error: unknown) {
        onError(error, 'parsing upgrade', req);
        internalDefaultErrorHandler(new HTTPError(400), req, {
          socket,
          head: VOID_BUFFER,
          hasUpgraded: false,
        });
        return undefined;
      }
      internalBeginResponse(props, true, { _target: socket, _head: head });
      head = VOID_BUFFER; // allow GC
      track(props);
      if (closeState === 1) {
        internalSoftClose(props, closeReason, closeOnError);
      } else if (closeState === 2) {
        internalHardClose(props);
        internalEndRequest(req);
        return;
      }
      const currentError = new ErrorAccumulator();
      const r = await internalRunHandler(handler, props, currentError);
      if (!currentError._hasError && (r === CONTINUE || r === NEXT_ROUTE || r === NEXT_ROUTER)) {
        // ideally we would automatically fall-back to a standard request here, but the Node.js
        // Server API doesn't support that, so we warn the user about a possible misconfiguration:
        console.warn(
          `Upgrade ${req.headers.upgrade} request for ${req.url} fell-through. This probably means you need to add shouldUpgrade to one of your upgrade handlers, or if this is intentional, explicitly reject the request (throw new HTTPError(404)) instead of using CONTINUE.`,
        );
        currentError._add(new HTTPError(404));
      }
      if (currentError._hasError) {
        onError(currentError._error, 'handling upgrade', req);
        if (props._upgradeErrorHandler) {
          props._upgradeErrorHandler(currentError._error);
        } else {
          internalDefaultErrorHandler(currentError._error, req, {
            socket,
            head: props._output?._head ?? VOID_BUFFER,
            hasUpgraded: Boolean(props._hasUpgraded),
          });
        }
        internalEndRequest(req);
      }
    },

    shouldUpgrade: (req) => {
      try {
        const props = internalBeginRequest(req, onError, true);
        return internalCheckShouldUpgrade(handler, props);
      } catch {
        return false; // error will be reported properly by request handler
      }
    },

    clientError: (error, socket) => {
      // This implementation matches Node.js default behaviour if there are no listeners
      // (sadly requires accessing the internal value _httpMessage)
      // https://github.com/nodejs/node/blob/e1e0830ae519765d7f0f941feb4f52b44a5adefc/lib/_http_server.js#L927

      const httpMessage = (socket as any)._httpMessage as ServerResponse | null; // eek! private API
      const code = (error as any).code as string | undefined;

      // `httpMessage` can be null if Node.js has not yet assigned a ServerResponse (in which
      // case we need to send a response), or if our handling code has already end()ed the
      // ServerResponse (in which case we _should_ not send a response, but it doesn't matter
      // because we will destroy the socket anyway).
      if (socket.writable && !httpMessage?.headersSent) {
        socket.end(ERROR_LOOKUP.get(code) ?? BAD_REQUEST_RESPONSE);
      }
      socket.destroy(error);

      // Custom behaviour from here:

      // `Error: read ECONNRESET at TCP.onStreamRead` usually means the client aborted
      // the connection while the server was sending data (and wanted an ACK).
      // Same observed as `EPIPE Error: write EPIPE` on Linux.

      if (code === 'HPE_INVALID_EOF_STATE') {
        // Client aborted before uploading the entire body
        // Possibly related: https://github.com/nodejs/node/issues/23897
        // Similar: https://github.com/expressjs/multer/issues/779
        // Already handled by the reader, so ignore it here.
      } else {
        onError(error, 'initialising request', undefined);
      }
    },

    softClose(reason, onError, callback) {
      if (closeState < 1) {
        closeState = 1;
        closeReason = reason;
        closeOnError = onError;
        for (const props of active) {
          internalSoftClose(props, reason, onError);
        }
      }
      addAllClosedCallback(callback);
    },

    hardClose(callback) {
      if (closeState < 2) {
        closeState = 2;
        for (const props of active) {
          internalHardClose(props);
        }
      }
      addAllClosedCallback(callback);
    },

    countConnections() {
      return active.size;
    },
  };
}

export const internalLogError: ServerGeneralErrorCallback = (error, context, req) => {
  if ((findCause(error, HTTPError)?.statusCode ?? 500) >= 500) {
    console.error(
      '%s',
      `unhandled error while ${context} ${req?.url ?? '(no request information)'}:`,
      error,
    );
  }
};

const makeErrorResponse = (code: number) =>
  Buffer.from(`HTTP/1.1 ${code} ${STATUS_CODES[code]}\r\nConnection: close\r\n\r\n`);

const ERROR_LOOKUP = /*@__PURE__*/ new Map<string | undefined, Buffer>([
  ['HPE_HEADER_OVERFLOW', /*@__PURE__*/ makeErrorResponse(431)],
  ['HPE_CHUNK_EXTENSIONS_OVERFLOW', /*@__PURE__*/ makeErrorResponse(413)],
  ['ERR_HTTP_REQUEST_TIMEOUT', /*@__PURE__*/ makeErrorResponse(408)],
]);

const BAD_REQUEST_RESPONSE = /*@__PURE__*/ makeErrorResponse(400);
