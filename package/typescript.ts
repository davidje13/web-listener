import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import {
  WebListener,
  getPathParameter,
  getPathParameters,
  makeAcceptWebSocket,
  makeWebSocketFallbackTokenFetcher,
  nextWebSocketMessage,
  requireAuthScope,
  requireBearerAuth,
  Router,
  WebSocketMessages,
  type WebSocketMessage,
  type WithPathParameters,
  ServerSentEvents,
} from 'web-listener';

// this file just checks types; the code is not executed

// assertion helper
type Equals<A, B> =
  (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? [] : ['nope'];
const assertType =
  <Actual>(_: Actual) =>
  <Expected>(..._typesDoNotMatch: Equals<Actual, Expected>) => {};

const r = new Router();
r.onRequest('GET', '/:foo{/:bar}/*baz', (req, res) => {
  assertType(getPathParameters(req))<Readonly<{ foo: string; bar?: string; baz: string[] }>>();
  assertType(getPathParameter(req, 'foo'))<string>();
  assertType(getPathParameter(req, 'bar'))<string | undefined>();
  assertType(getPathParameter(req, 'baz'))<string[]>();
  // @ts-expect-error
  getPathParameter(req, 'nope');
  res.writeHead(200);
});

const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);
r.ws('/ws1', async (req) => {
  const ws = await acceptWebSocket(req);
  assertType(ws)<WebSocket>();

  assertType(await nextWebSocketMessage(ws))<WebSocketMessage>();
});

makeAcceptWebSocket(WebSocketServer, { autoPong: true });

// @ts-expect-error
makeAcceptWebSocket(WebSocketServer, { backlog: 10 });

class WS2 extends WebSocket {}
const acceptWebSocket2 = makeAcceptWebSocket(WebSocketServer, { WebSocket: WS2 });
r.ws('/ws2', async (req) => {
  const ws = await acceptWebSocket2(req);
  assertType(ws)<WS2>();

  const messages = new WebSocketMessages(ws);
  assertType(await messages.next())<WebSocketMessage>();
  for await (const message of messages) {
    assertType(message)<WebSocketMessage>();
  }
  messages.detach();
});

r.use(
  requireBearerAuth({
    realm: 'my realm',
    extractAndValidateToken(token, realm, req) {
      assertType(token)<string>();
      assertType(realm)<string>();
      assertType(req)<IncomingMessage>();
      return { nbf: 1000, exp: 8000, scopes: ['foo', 'bar'] };
    },
    fallbackTokenFetcher: makeWebSocketFallbackTokenFetcher(acceptWebSocket),
    closeOnExpiry: true,
    softCloseBufferTime: 5000,
    onSoftCloseError(err, action, req) {
      assertType(err)<unknown>();
      assertType(action)<string>();
      assertType(req)<IncomingMessage>();
    },
  }),
  requireAuthScope('foo'),
);

const subRouter = new Router<WithPathParameters<{ foo: string }>>();
subRouter.within('/:a', (sub) =>
  sub.get('/*b', (req, res) => {
    assertType(getPathParameters(req))<Readonly<{ foo: string; a: string; b: string[] }>>();
    res.write('response');
    res.end();
  }),
);
r.mount('/:foo', subRouter);
r.mount('/:foo/:extra', subRouter);

// @ts-expect-error
r.mount('/:foo2', subRouter);

// @ts-expect-error
r.mount('/*foo', subRouter);

// @ts-expect-error
r.mount('/no-params', subRouter);

// @ts-expect-error
r.mount('/:foo', new Router<WithPathParameters<{ foo: string; bar: string }>>());

const subRouterNoParams = new Router();
subRouterNoParams.get('/:p', (req) => {
  assertType(getPathParameters(req))<Readonly<{ p: string }>>();
});

r.mount('/nothing', subRouterNoParams);
r.mount('/:anything', subRouterNoParams);

r.on('GET /:id/:2', async (req, res) => {
  const sse = new ServerSentEvents(req, res);
  const proxy = new EventSource('https://example.com');
  proxy.addEventListener('message', (ev) => {
    sse.send({ event: 'proxied', data: ev.data });
  });
  sse.signal.addEventListener('abort', () => proxy.close());
});

// @ts-expect-error
r.on('GET/:id/:2', () => null);

new WebListener(r).listen(8080, 'localhost');

// @ts-expect-error
new WebListener(subRouter);
