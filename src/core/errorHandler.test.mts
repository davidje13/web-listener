import type { IncomingMessage } from 'node:http';
import { Writable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { SocketServerResponse } from '../polyfill/SocketServerResponse.mts';
import { HTTPError } from './HTTPError.mts';
import { internalRequestErrorHandler } from './errorHandler.mts';
import 'lean-test';

describe('internalRequestErrorHandler', () => {
  it('sends the error as a HTTP response', async () => {
    const mockNetwork = makeMockNetwork();
    const error = new HTTPError(400, {
      statusMessage: 'Oops',
      message: 'internal',
      headers: { foo: 'bar' },
      body: 'Public facing error message',
      cause: new Error('also internal'),
    });
    const req = {} as IncomingMessage;
    internalRequestErrorHandler(error, req, mockNetwork.response, { extra: 'header' });
    expect(await mockNetwork.read()).equals(
      [
        'HTTP/1.1 400 Oops',
        'content-type: text/plain; charset=utf-8',
        'foo: bar',
        'content-length: 27',
        'extra: header',
        '',
        'Public facing error message',
      ].join('\r\n'),
    );
  });

  it('ends the response without content if the headers have already been sent', async () => {
    const mockNetwork = makeMockNetwork();
    const error = new HTTPError(400, {
      statusMessage: 'Oops',
      message: 'internal',
      headers: { foo: 'bar' },
      body: 'Public facing error message',
      cause: new Error('also internal'),
    });
    const req = {} as IncomingMessage;
    mockNetwork.response.writeHead(200);
    internalRequestErrorHandler(error, req, mockNetwork.response);
    expect(await mockNetwork.read()).equals(['HTTP/1.1 200 OK', '', ''].join('\r\n'));
  });
});

function makeMockNetwork() {
  const out = new TransformStream();
  const response = new SocketServerResponse(Writable.fromWeb(out.writable));
  return { response, read: () => text(out.readable) };
}
