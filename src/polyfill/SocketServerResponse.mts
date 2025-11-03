import { STATUS_CODES, type OutgoingHttpHeader, type OutgoingHttpHeaders } from 'node:http';
import type { Writable } from 'node:stream';

// This class exists because it is not possible to construct a built-in ServerResponse
// on an arbitrary socket. It attempts to mimic a subset of the ServerResponse API.

export class SocketServerResponse {
  /** @internal */ private _socket: Writable;
  /** @internal */ private readonly _headers: OutgoingHttpHeaders;
  /** @internal */ private _headersSent: boolean;

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
    statusMessage?: string,
    headers?: OutgoingHttpHeaders | OutgoingHttpHeader[],
  ): this {
    if (this._headersSent) {
      throw new Error('headers already sent');
    }
    const finalHeaders = { ...this._headers };
    for (const [k, v] of internalNormaliseOutgoingHeaders(headers)) {
      finalHeaders[k] = v;
    }
    this._socket.write(
      [
        `HTTP/1.1 ${statusCode} ${safe(statusMessage ?? STATUS_CODES[statusCode] ?? '-')}`,
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
      throw new Error('headers must be a list of alternating keys and values');
    }
    for (let i = 0; i < size; i += 2) {
      const k = headers[i];
      const v = headers[i + 1];
      if (typeof k !== 'string') {
        throw new Error('invalid header name');
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
