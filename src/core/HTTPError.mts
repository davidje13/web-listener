import { STATUS_CODES, type OutgoingHttpHeaders } from 'node:http';
import { internalNormaliseHeaderValue } from '../polyfill/SocketServerResponse.mts';

type AnyHeaders =
  | HeadersInit
  | OutgoingHttpHeaders
  | Map<string, string | number | Readonly<string[]>>
  | undefined;

export interface HTTPErrorOptions {
  message?: string | undefined;
  statusMessage?: string | undefined;
  headers?: AnyHeaders;
  body?: string | undefined;
  cause?: unknown;
}

export class HTTPError extends Error {
  declare public readonly statusCode: number;
  declare public readonly statusMessage: string;
  declare public readonly headers: Headers;
  declare public readonly body: string;

  constructor(
    statusCode: number,
    { message, statusMessage, headers, body, ...options }: HTTPErrorOptions = {},
  ) {
    super(message ?? body, options);
    this.statusCode = statusCode | 0;
    this.statusMessage = statusMessage ?? STATUS_CODES[this.statusCode] ?? '-';
    this.headers = internalNormaliseHeaders(headers);
    this.body = body ?? '';
    this.name = `HTTPError(${this.statusCode} ${this.statusMessage})`;
  }
}

function internalNormaliseHeaders(headers: AnyHeaders): Headers {
  if (!headers || headers instanceof Headers || Array.isArray(headers)) {
    return new Headers(headers);
  }
  const entries = headers instanceof Map ? [...headers.entries()] : Object.entries(headers);
  return new Headers(
    entries
      .map(([k, v]): [string, string] => [k, internalNormaliseHeaderValue(v)])
      .filter(([_, v]) => v),
  );
}
