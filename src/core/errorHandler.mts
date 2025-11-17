import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http';
import type { Duplex } from 'node:stream';
import { SocketServerResponse } from '../polyfill/SocketServerResponse.mts';
import { findCause } from '../util/findCause.mts';
import { HTTPError } from './HTTPError.mts';

export type RequestErrorHandler = (
  error: unknown,
  req: IncomingMessage,
  res: ServerResponse,
) => void;

interface PartialServerResponse {
  get headersSent(): boolean;
  setHeaders(headers: Headers): void;
  setHeader(name: string, value: string): void;
  writeHead(
    status: number,
    message: string | undefined,
    extraHeaders?: OutgoingHttpHeaders | undefined,
  ): void;
  end(chunk?: string, encoding?: BufferEncoding): void;
}

export const internalRequestErrorHandler = (
  error: unknown,
  _: IncomingMessage,
  res: PartialServerResponse,
  extraHeaders?: OutgoingHttpHeaders,
) => {
  if (!res.headersSent) {
    const httpError = findCause(error, HTTPError) ?? new HTTPError(500);
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.setHeaders(httpError.headers);
    res.setHeader('content-length', String(Buffer.byteLength(httpError.body, 'utf-8')));
    res.writeHead(httpError.statusCode, httpError.statusMessage, extraHeaders);
    res.end(httpError.body, 'utf-8');
  } else {
    res.end();
  }
};

export type UpgradeErrorHandler = (error: unknown, req: IncomingMessage, socket: Duplex) => void;

export const internalUpgradeErrorHandler: UpgradeErrorHandler = (error, req, socket) => {
  if (socket.writable) {
    socket.addListener('finish', () => socket.destroy());
    const res = new SocketServerResponse(socket);
    internalRequestErrorHandler(error, req, res, { connection: 'close' });
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
