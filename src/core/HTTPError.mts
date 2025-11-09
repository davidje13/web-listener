import { STATUS_CODES, type OutgoingHttpHeaders } from 'node:http';
import { internalNormaliseHeaderValue } from '../polyfill/SocketServerResponse.mts';

type MessageBody = string | Buffer | NodeJS.ArrayBufferView | ArrayBuffer | SharedArrayBuffer;

type AnyHeaders =
  | HeadersInit
  | OutgoingHttpHeaders
  | Map<string, string | number | Readonly<string[]>>
  | undefined;

export interface HTTPErrorOptions {
  message?: string;
  statusMessage?: string;
  headers?: AnyHeaders;
  body?: MessageBody;
  cause?: unknown;
}

interface PartialServerResponse {
  setHeaders(headers: Headers): void;
  setHeader(name: string, value: string): void;
  writeHead(status: number, message: string, extraHeaders?: OutgoingHttpHeaders): void;
  end(chunk: MessageBody, encoding: BufferEncoding): void;
}

export class HTTPError extends Error {
  public readonly statusCode: number;
  public readonly statusMessage: string;
  public readonly headers: AnyHeaders;
  public readonly body: MessageBody;

  constructor(
    statusCode: number,
    { message, statusMessage, headers, body, ...options }: HTTPErrorOptions = {},
  ) {
    super(message ?? (typeof body === 'string' ? body : undefined), options);
    this.statusCode = statusCode | 0;
    this.statusMessage = statusMessage ?? STATUS_CODES[this.statusCode] ?? '-';
    this.headers = headers;
    this.body = body ?? '';
    this.name = `HTTPError(${this.statusCode} ${this.statusMessage})`;
  }

  static readonly INTERNAL_SERVER_ERROR = /*@__PURE__*/ new HTTPError(500);

  send(res: PartialServerResponse, extraHeaders?: OutgoingHttpHeaders) {
    res.setHeaders(internalNormaliseHeaders(this.headers));
    const contentLength = Buffer.byteLength(this.body, 'utf-8');
    res.setHeader('content-length', String(contentLength));
    res.writeHead(this.statusCode, this.statusMessage, extraHeaders);
    res.end(this.body, 'utf-8');
  }
}

function internalNormaliseHeaders(headers: AnyHeaders): Headers {
  if (!headers) {
    return new Headers();
  } else if (headers instanceof Headers) {
    return headers;
  } else if (Array.isArray(headers)) {
    return new Headers(headers);
  } else {
    const entries = headers instanceof Map ? [...headers.entries()] : Object.entries(headers);
    return new Headers(
      entries
        .map(([k, v]): [string, string] => [k, internalNormaliseHeaderValue(v)])
        .filter(([_, v]) => v),
    );
  }
}
