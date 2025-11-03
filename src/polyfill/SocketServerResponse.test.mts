import { TransformStream, ReadableStream } from 'node:stream/web';
import { Writable } from 'node:stream';
import {
  internalEncodeHeaders,
  internalNormaliseHeaderValue,
  SocketServerResponse,
} from './SocketServerResponse.mts';
import 'lean-test';

describe('SocketServerResponse', () => {
  it('mimics part of the ServerResponse API', async () => {
    const mockSocket = new TransformStream();
    const response = new SocketServerResponse(Writable.fromWeb(mockSocket.writable));
    response.setHeader('foo', 'bar');
    response.setHeaders(new Headers({ zig: 'zag' }));
    expect(response.headersSent).isFalse();
    response.writeHead(200, 'Yep', { extra: ['this', 'that'] });
    response.write('this is some ');
    response.end('body content!');

    const sent = await readAll(mockSocket.readable, 'ascii');
    expect(sent).equals(
      [
        'HTTP/1.1 200 Yep',
        'foo: bar',
        'zig: zag',
        'extra: this, that',
        '',
        'this is some body content!',
      ].join('\r\n'),
    );
  });
});

describe('encodeHeaders', () => {
  it('creates safe header lines from arbitrary input', () => {
    expect(
      internalEncodeHeaders({
        'content-type': 'text/html; charset="utf-8"',
        messy: 'invalid\r\nnewlines!',
      }),
    ).equals(['content-type: text/html; charset="utf-8"', 'messy: invalidnewlines!']);
  });

  it('skips blank values', () => {
    expect(internalEncodeHeaders({ foo: '', bar: undefined, baz: [] })).equals([]);
  });
});

describe('normaliseHeaderValue', () => {
  it('combines headers into a single string', () => {
    expect(internalNormaliseHeaderValue('foo')).equals('foo');
    expect(internalNormaliseHeaderValue(1)).equals('1');
    expect(internalNormaliseHeaderValue(['foo', 'bar'])).equals('foo, bar');
    expect(internalNormaliseHeaderValue(['foo', 'bar, baz'])).equals('foo, bar, baz');
  });
});

async function readAll(readable: ReadableStream, encoding: BufferEncoding) {
  const buffers: Buffer[] = [];
  for await (const chunk of readable) {
    buffers.push(chunk);
  }
  return Buffer.concat(buffers).toString(encoding);
}
