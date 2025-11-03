import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { SocketServerResponse } from '../polyfill/SocketServerResponse.mts';
import { findCause } from '../util/findCause.mts';
import { HTTPError } from './HTTPError.mts';

export type RequestErrorHandler = (
  error: unknown,
  req: IncomingMessage,
  res: ServerResponse,
) => void;

export const internalRequestErrorHandler: RequestErrorHandler = (error, _, res) => {
  if (!res.headersSent) {
    const httpError = findCause(error, HTTPError) ?? HTTPError.INTERNAL_SERVER_ERROR;
    httpError.send(res);
  } else {
    res.end();
  }
};

export type UpgradeErrorHandler = (error: unknown, req: IncomingMessage, socket: Duplex) => void;

export const internalUpgradeErrorHandler: UpgradeErrorHandler = (error, _, socket) => {
  if (socket.writable) {
    socket.addListener('finish', () => socket.destroy());
    const res = new SocketServerResponse(socket);
    const httpError = findCause(error, HTTPError) ?? HTTPError.INTERNAL_SERVER_ERROR;
    httpError.send(res, { connection: 'close' });
  } else {
    socket.destroy();
  }
};

export type ServerGeneralErrorCallback = (
  error: unknown,
  action: string,
  req?: IncomingMessage,
) => void;
export type ServerErrorCallback = (error: unknown, action: string, req: IncomingMessage) => void;

export const internalLogError: ServerGeneralErrorCallback = (error, action, req) => {
  if (findCause(error, HTTPError)?.statusCode ?? 500 >= 500) {
    console.error(
      '%s',
      `unhandled error while ${action} ${req?.url ?? '(no request information)'}:`,
      error,
    );
  }
};
