import { SocketServerResponse } from '../polyfill/SocketServerResponse.mts';
import { findCause } from '../util/findCause.mts';
import { HTTPError } from './HTTPError.mts';
import type { ErrorHandlerFn, ErrorOutput } from './handler.mts';

/**
 * The default error handler invoked if an error reaches the end of the chain without being handled. This sends the error information as a text/plain response.
 */
export const internalDefaultErrorHandler: ErrorHandlerFn = (error, _, output) => {
  const res = getResponse(output);
  if (!res) {
    return;
  }

  const httpError = findCause(error, HTTPError) ?? new HTTPError(500);
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeaders(httpError.headers);
  res.setHeader('content-length', String(Buffer.byteLength(httpError.body, 'utf-8')));
  if (!output.response) {
    res.setHeader('connection', 'close');
  }
  res.writeHead(httpError.statusCode, httpError.statusMessage);
  res.end(httpError.body, 'utf-8');
};

export function getResponse(output: ErrorOutput) {
  if (output.response) {
    const res = output.response;
    if (res.headersSent) {
      res.end();
      return undefined;
    }
    return res;
  }
  const socket = output.socket;
  if (output.hasUpgraded || !socket.writable) {
    socket.destroy();
    return undefined;
  }
  socket.addListener('finish', () => socket.destroy());
  return new SocketServerResponse(socket);
}
