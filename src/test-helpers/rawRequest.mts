import { createConnection, Socket } from 'node:net';
import { Duplex, Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { ReadableStream } from 'node:stream/web';

// fetch() and request() automatically sanitise the path, which is no good if
// we want to test attacks, so this makes a raw socket connection

// rawRequestStream also allows us to stream the response while still streaming
// the request (unlike fetch() and request() which wait for the request to
// complete before streaming the response)

export async function rawRequest(
  target: string,
  init?: Pick<RequestInit, 'method' | 'body' | 'headers'>,
) {
  const socket = await rawRequestStream(target, init);
  return await text(socket);
}

export function unchunk(response: string): string {
  // This function normalises chunked output for tests in Node 20 (which does not support
  // ServerResponse corking). Once Node 20 is end-of-life, we can remove it.
  if (Number(process.versions.node.split('.')[0]) >= 21) {
    return response;
  }
  let chunks = [];
  let p = response.indexOf('\r\n\r\n') + 4;
  while (true) {
    const sep = response.indexOf('\r\n', p);
    if (sep === -1) {
      throw new Error('malformed response: ' + response);
    }
    const size = Number.parseInt(response.substring(p, sep), 16);
    chunks.push(response.substring(sep + 2, sep + 2 + size));
    if (size === 0) {
      break;
    }
    p = sep + 2 + size + 2;
  }
  return chunks.join('');
}

export async function rawRequestStream(
  target: string,
  init: Pick<RequestInit, 'method' | 'body' | 'headers'> = {},
) {
  const parts = /^(http:\/\/[^\/]+)(\/.*)?$/.exec(target);
  if (!parts) {
    throw new TypeError('unsupported url');
  }
  const url = new URL(parts[1]!);
  const socket = await openRawSocket(url);
  makeRequestOnSocket(socket, url.host, parts[2] ?? '/', init);
  return socket;
}

export function openRawSocket(url: URL, { allowHalfOpen = false } = {}) {
  let hostname = url.hostname;
  if (hostname[0] === '[') {
    hostname = hostname.substring(1, hostname.length - 1);
  }
  return new Promise<Socket>((resolve, reject) => {
    const socket = createConnection(
      { port: Number.parseInt(url.port), host: hostname, allowHalfOpen },
      () => resolve(socket),
    );
    socket.once('error', reject);
  });
}

export function makeRequestOnSocket(
  socket: Socket,
  host: string,
  path: string,
  init: Pick<RequestInit, 'method' | 'body' | 'headers'>,
) {
  const headers = new Headers(init?.headers);
  headers.set('host', host);
  if (!headers.has('content-length') && !headers.has('transfer-encoding') && init.body) {
    if (typeof init.body === 'string') {
      headers.set('content-length', String(Buffer.byteLength(init.body, 'utf-8')));
    } else {
      headers.set('transfer-encoding', 'chunked');
    }
  }
  const chunked = headers.get('transfer-encoding') === 'chunked';
  if (!headers.get('connection')?.includes('keep-alive')) {
    headers.append('connection', 'close');
  }
  socket.write(
    [
      `${init?.method ?? 'GET'} ${path} HTTP/1.1`,
      ...[...headers].map(([k, v]) => `${k}: ${v}`),
      '',
      '',
    ].join('\r\n'),
    'ascii',
  );
  const body = init?.body;
  if (!body) {
    return;
  }
  if (typeof body === 'string') {
    if (chunked) {
      const length = Buffer.byteLength(body, 'utf-8');
      socket.cork();
      socket.write(length.toString(16));
      socket.write('\r\n');
      socket.write(body, 'utf-8');
      socket.write('\r\n');
      socket.write(`0\r\n\r\n`);
      socket.uncork();
    } else {
      socket.write(body, 'utf-8');
    }
    return;
  }
  let bodyStream: Readable;
  if (body instanceof ReadableStream) {
    bodyStream = Readable.fromWeb(body);
  } else if (body instanceof Readable || body instanceof Duplex) {
    bodyStream = body;
  } else {
    throw new TypeError('unsupported body type');
  }
  (async () => {
    for await (const chunk of bodyStream) {
      if (chunked) {
        const length = Buffer.byteLength(chunk);
        socket.cork();
        socket.write(length.toString(16));
        socket.write('\r\n');
        socket.write(chunk);
        socket.write('\r\n');
        socket.uncork();
      } else {
        socket.write(chunk);
      }
    }
    if (chunked) {
      socket.write(`0\r\n\r\n`);
    }
  })();
}
