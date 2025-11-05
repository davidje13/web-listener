import {
  STATUS_CODES,
  type IncomingMessage,
  type RequestListener,
  type ServerResponse,
} from 'node:http';
import type {
  ClientErrorListener,
  ShouldUpgradeCallback,
  UpgradeListener,
} from '../polyfill/serverTypes.mts';
import { VOID_BUFFER } from '../util/voidBuffer.mts';
import { ErrorAccumulator } from '../util/ErrorAccumulator.mts';
import type { WithoutPathParameters } from './pathParameters.mts';
import { internalCheckShouldUpgrade, internalRunHandler } from './Router.mts';
import type { Handler } from './handler.mts';
import { internalBeginRequest, internalBeginResponse, type MessageProps } from './messages.mts';
import { CONTINUE, NEXT_ROUTE, NEXT_ROUTER } from './RoutingInstruction.mts';
import { HTTPError } from './HTTPError.mts';
import {
  internalLogError,
  internalRequestErrorHandler,
  internalUpgradeErrorHandler,
  type ServerGeneralErrorCallback,
  type ServerErrorCallback,
} from './errorHandler.mts';
import { internalHardClose, internalSoftClose } from './close.mts';

export interface NativeListenersOptions {
  onError?: ServerGeneralErrorCallback;
  socketCloseTimeout?: number;
}

export interface NativeListeners {
  request: RequestListener;
  upgrade: UpgradeListener;
  shouldUpgrade: ShouldUpgradeCallback;
  clientError: ClientErrorListener;
  softClose(reason: string, onError: ServerErrorCallback, callback?: () => void): void;
  hardClose(callback?: () => void): void;
  countConnections(): number;
}

export function toListeners(
  handler: Handler<WithoutPathParameters>,
  { onError = internalLogError, socketCloseTimeout = 500 }: NativeListenersOptions = {},
): NativeListeners {
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
  const teardownError = (error: unknown, req: IncomingMessage) =>
    onError(error, 'tearing down', req);

  return {
    request: async (req, res) => {
      let props: MessageProps;
      try {
        props = internalBeginRequest(req, false);
      } catch (error: unknown) {
        onError(error, 'parsing request', req);
        internalRequestErrorHandler(new HTTPError(400), req, res);
        return undefined;
      }
      internalBeginResponse(props, false, { _target: res }, teardownError);
      track(props);
      const currentError = new ErrorAccumulator();
      const r = await internalRunHandler(handler, props, currentError);
      if (currentError._hasError) {
        onError(currentError._error, 'handling request', req);
        internalRequestErrorHandler(currentError._error, req, res);
      } else if (r === CONTINUE || r === NEXT_ROUTE || r === NEXT_ROUTER) {
        internalRequestErrorHandler(new HTTPError(404), req, res);
      }
    },

    upgrade: async (req, socket, head) => {
      socket.once('finish', () => {
        // do not allow half-open sockets to linger
        const tm = setTimeout(() => socket.destroy(), socketCloseTimeout);
        socket.once('close', () => clearTimeout(tm));
      });

      let props: MessageProps;
      try {
        props = internalBeginRequest(req, true);
      } catch (error: unknown) {
        onError(error, 'parsing upgrade', req);
        internalUpgradeErrorHandler(new HTTPError(400), req, socket);
        return undefined;
      }
      internalBeginResponse(props, true, { _target: socket, _head: head }, teardownError);
      head = VOID_BUFFER; // allow GC
      track(props);
      const currentError = new ErrorAccumulator();
      const r = await internalRunHandler(handler, props, currentError);
      if (currentError._hasError) {
        onError(currentError._error, 'handling upgrade', req);
        props._fallbackUpgradeErrorHandler(currentError._error, req, socket);
      } else if (r === CONTINUE || r === NEXT_ROUTE || r === NEXT_ROUTER) {
        // ideally we would automatically fall-back to a standard request here, but the Node.js
        // Server API doesn't support that, so we warn the user about a possible misconfiguration:
        console.warn(
          `Upgrade ${req.headers.upgrade} request for ${req.url} fell-through. This probably means you need to add shouldUpgrade to one of your upgrade handlers, or if this is intentional, explicitly reject the request (throw new HTTPError(404)) instead of using CONTINUE.`,
        );
        props._fallbackUpgradeErrorHandler(new HTTPError(404), req, socket);
      }
    },

    shouldUpgrade: (req) => {
      try {
        const props = internalBeginRequest(req, true);
        props._shouldUpgradeErrorHandler = (error) =>
          onError(error, 'checking should upgrade', req);
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
        onError(error, 'initialising request');
      }
    },

    softClose(reason, onError, callback) {
      for (const props of active) {
        void internalSoftClose(props, reason, onError);
      }
      addAllClosedCallback(callback);
    },

    hardClose(callback) {
      for (const props of active) {
        internalHardClose(props);
      }
      addAllClosedCallback(callback);
    },

    countConnections() {
      return active.size;
    },
  };
}

const makeErrorResponse = (code: number) =>
  Buffer.from(`HTTP/1.1 ${code} ${STATUS_CODES[code]}\r\nConnection: close\r\n\r\n`);

const ERROR_LOOKUP = new Map<string | undefined, Buffer>([
  ['HPE_HEADER_OVERFLOW', makeErrorResponse(431)],
  ['HPE_CHUNK_EXTENSIONS_OVERFLOW', makeErrorResponse(413)],
  ['ERR_HTTP_REQUEST_TIMEOUT', makeErrorResponse(408)],
]);

const BAD_REQUEST_RESPONSE = makeErrorResponse(400);
