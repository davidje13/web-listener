import { STATUS_CODES } from 'node:http';
import { internalNormaliseHeaders, type AnyHeaders } from '../util/normaliseHeaders.mts';

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
