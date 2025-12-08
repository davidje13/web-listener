import type { IncomingMessage, ServerResponse } from 'node:http';
import { Writable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { SocketServerResponse } from '../polyfill/SocketServerResponse.mts';
import { HTTPError } from './HTTPError.mts';
import { internalDefaultErrorHandler } from './defaultErrorHandler.mts';
import 'lean-test';

describe('defaultErrorHandler', () => {
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
    internalDefaultErrorHandler(error, req, { response: mockNetwork.response });
    expect(await mockNetwork.read()).equals(
      [
        'HTTP/1.1 400 Oops',
        'content-type: text/plain; charset=utf-8',
        'x-content-type-options: nosniff',
        'foo: bar',
        'content-length: 27',
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
    internalDefaultErrorHandler(error, req, { response: mockNetwork.response });
    expect(await mockNetwork.read()).equals(['HTTP/1.1 200 OK', '', ''].join('\r\n'));
  });
});

function makeMockNetwork() {
  const out = new TransformStream();
  const response = new SocketServerResponse(
    Writable.fromWeb(out.writable),
  ) as unknown as ServerResponse;
  return { response, read: () => text(out.readable) };
}
