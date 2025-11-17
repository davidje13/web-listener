import { STATUS_CODES, type OutgoingHttpHeaders } from 'node:http';
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

  writeHead(statusCode: number, statusMessage = STATUS_CODES[statusCode] ?? '-'): this {
    if (this._headersSent) {
      throwCodedError(
        new Error('Cannot write headers after they are sent to the client'),
        'ERR_HTTP_HEADERS_SENT',
      );
    }
    this._socket.write(
      [
        `HTTP/1.1 ${statusCode} ${safe(statusMessage)}`,
        ...internalEncodeHeaders(this._headers),
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
