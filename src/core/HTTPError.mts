import { STATUS_CODES } from 'node:http';
import { internalNormaliseHeaders, type AnyHeaders } from '../util/normaliseHeaders.mts';

export interface HTTPErrorOptions {
  /**
   * A message to include in system logs.
   * Use `body` to specify a client-facing error message.
   *
   * @default body
   */
  message?: string | undefined;
  /**
   * A HTTP status message to send along with the status code.
   * If not set, this is chosen automatically based on the status code.
   */
  statusMessage?: string | undefined;
  /**
   * HTTP headers to send when reporting this error to the client.
   */
  headers?: AnyHeaders | undefined;
  /**
   * A client-facing error message.
   * Use `message` to specify an internal message for logging.
   */
  body?: string | undefined;
  /**
   * Another error which was the cause of this error.
   * Not included in the client-facing message.
   */
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
