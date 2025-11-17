import { STATUS_CODES, type OutgoingHttpHeader, type OutgoingHttpHeaders } from 'node:http';
import type { Writable } from 'node:stream';
import { throwCodedError } from '../util/throwCodedError.mts';

// This class exists because it is not possible to construct a built-in ServerResponse
// on an arbitrary socket. It attempts to mimic a subset of the ServerResponse API.

export class SocketServerResponse {
  /** @internal */ declare private _socket: Writable;
  /** @internal */ declare private readonly _headers: OutgoingHttpHeaders;
  /** @internal */ declare private _headersSent: boolean;

  constructor(socket: Writable) {
    this._socket = socket;
    this._headers = Object.create(null);
    this._headersSent = false;
  }

  get headersSent() {
    return this._headersSent;
  }

  writeHead(
    statusCode: number,
    statusMessage = STATUS_CODES[statusCode] ?? '-',
    headers?: OutgoingHttpHeaders | OutgoingHttpHeader[] | undefined,
  ): this {
    if (this._headersSent) {
      throwCodedError(
        new Error('Cannot write headers after they are sent to the client'),
        'ERR_HTTP_HEADERS_SENT',
      );
    }
    const finalHeaders = { ...this._headers };
    for (const [k, v] of internalNormaliseOutgoingHeaders(headers)) {
      finalHeaders[k] = v;
    }
    this._socket.write(
      [
        `HTTP/1.1 ${statusCode} ${safe(statusMessage)}`,
        ...internalEncodeHeaders(finalHeaders),
        '',
        '',
      ].join('\r\n'),
      'ascii',
    );
    this._headersSent = true;
    return this;
  }

  write(chunk: unknown, encoding: BufferEncoding = 'utf-8', cb?: () => void): boolean {
    return this._socket.write(chunk, encoding, cb);
  }

  end(chunk?: unknown, encoding: BufferEncoding = 'utf-8', cb?: () => void): this {
    this._socket.end(chunk, encoding, cb);
    return this;
  }

  setHeader(name: string, value: Readonly<LooseHeaderValue>): this {
    const key = name.toLowerCase();
    if (typeof value === 'string' || typeof value === 'number') {
      this._headers[key] = value;
    } else {
      this._headers[key] = [...value];
    }
    return this;
  }

  setHeaders(headers: Headers | Map<string, Readonly<LooseHeaderValue>>): this {
    for (const [k, v] of headers) {
      this.setHeader(k, v);
    }
    return this;
  }
}

type LooseHeaderValue = string | number | Readonly<string[]>;

export function internalEncodeHeaders(
  headers: Record<string, LooseHeaderValue | undefined>,
): string[] {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(headers)) {
    const value = internalNormaliseHeaderValue(v);
    if (value) {
      lines.push(`${safe(k)}: ${safe(value)}`);
    }
  }
  return lines;
}

export const internalNormaliseHeaderValue = (v: LooseHeaderValue | undefined) =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : v ? v.join(', ') : '';

const safe = (x: string) => x.replaceAll(/[^ \t!-~]/g, '');

function internalNormaliseOutgoingHeaders(
  headers: OutgoingHttpHeaders | OutgoingHttpHeader[] | undefined,
): [string, OutgoingHttpHeader][] {
  if (!headers) {
    return [];
  }
  const r: [string, OutgoingHttpHeader][] = [];
  if (Array.isArray(headers)) {
    const size = headers.length;
    if (size & 1) {
      throwCodedError(
        new TypeError("The argument 'headers' is invalid"),
        'ERR_INVALID_ARG_VALUE',
        internalNormaliseOutgoingHeaders,
      );
    }
    for (let i = 0; i < size; i += 2) {
      const k = headers[i];
      const v = headers[i + 1];
      if (typeof k !== 'string') {
        throwCodedError(
          new TypeError("The argument 'headers' is invalid"),
          'ERR_INVALID_ARG_VALUE',
          internalNormaliseOutgoingHeaders,
        );
      }
      if (v !== undefined) {
        r.push([k.toLowerCase(), v]);
      }
    }
  } else {
    for (const [k, v] of Object.entries(headers)) {
      if (v !== undefined) {
        r.push([k.toLowerCase(), v]);
      }
    }
  }
  return r;
}
