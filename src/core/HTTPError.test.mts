import { Writable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { SocketServerResponse } from '../polyfill/SocketServerResponse.mts';
import { HTTPError } from './HTTPError.mts';
import 'lean-test';

describe('HTTPError', () => {
  describe('send', () => {
    it('sends the error as a HTTP response', async () => {
      const mockNetwork = makeMockNetwork();
      const error = new HTTPError(400, {
        statusMessage: 'Oops',
        message: 'internal',
        headers: { foo: 'bar' },
        body: 'Public facing error message',
        cause: new Error('also internal'),
      });
      error.send(mockNetwork.response, { extra: 'header' });
      expect(await mockNetwork.read()).equals(
        [
          'HTTP/1.1 400 Oops',
          'foo: bar',
          'content-length: 27',
          'extra: header',
          '',
          'Public facing error message',
        ].join('\r\n'),
      );
    });
  });
});

function makeMockNetwork() {
  const out = new TransformStream();
  const response = new SocketServerResponse(Writable.fromWeb(out.writable));
  return { response, read: () => text(out.readable) };
}
