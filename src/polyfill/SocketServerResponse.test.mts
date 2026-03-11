import { writableString } from '../test-helpers/writableString.mts';
import {
  internalEncodeHeaders,
  internalNormaliseHeaderValue,
  SocketServerResponse,
} from './SocketServerResponse.mts';
import 'lean-test';

describe('SocketServerResponse', () => {
  it('mimics part of the ServerResponse API', async () => {
    const writable = writableString();
    const response = new SocketServerResponse(writable);
    response.setHeader('foo', 'bar');
    response.setHeaders(new Headers({ zig: 'zag' }));
    expect(response.headersSent).isFalse();
    response.writeHead(200, 'Yep');
    response.write('this is some ');
    response.end('body content!');

    const sent = writable.currentText('ascii');
    expect(sent).equals(
      ['HTTP/1.1 200 Yep', 'foo: bar', 'zig: zag', '', 'this is some body content!'].join('\r\n'),
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
