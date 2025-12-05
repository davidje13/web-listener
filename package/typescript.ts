import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
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
  upgradeHandler,
  typedErrorHandler,
  jsonErrorHandler,
  emitError,
  conditionalErrorHandler,
  acceptUpgrade,
  Negotiator,
} from 'web-listener';

// this file just checks types; the code is not executed

const r = new Router();
r.onRequest('GET', '/:foo{/:bar}/*baz', (req, res) => {
  assertType(getPathParameters(req))<Readonly<{ foo: string; bar?: string; baz: string[] }>>();
  assertType(getPathParameter(req, 'foo'))<string>();
  assertType(getPathParameter(req, 'bar'))<string | undefined>();
  assertType(getPathParameter(req, 'baz'))<string[]>();
  assertType(getPathParameter(req, 'nope'))<undefined>();

  let dynamicKey = 'foo';
  assertType(getPathParameter(req, dynamicKey))<string | string[] | undefined>();

  res.writeHead(200);
});

function dynamicRequestType(req: IncomingMessage) {
  assertType(getPathParameter(req, 'foo'))<string | string[] | undefined>();
}

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

r.onUpgrade('GET', 'foo', '/:id', async (req) => {
  const accepted = await acceptUpgrade(req, async (req, socket, head) => {
    assertType(getPathParameter(req, 'id'))<string>();
    assertType(socket)<Duplex>();
    assertType(head)<Buffer>();
    return {
      return: 1,
      onError: (error) => {
        assertType(error)<unknown>();
      },
      softCloseHandler: (reason) => {
        assertType(reason)<string>();
      },
    };
  });
  assertType(accepted)<number>();
});

const auth = requireBearerAuth({
  realm: 'my realm',
  extractAndValidateToken(token, realm, req) {
    assertType(token)<string>();
    assertType(realm)<string>();
    assertType(req)<IncomingMessage>();
    return { nbf: 1000, exp: 8000, scopes: ['foo', 'bar'], extra: {} };
  },
  fallbackTokenFetcher: makeWebSocketFallbackTokenFetcher(acceptWebSocket),
  closeOnExpiry: true,
  softCloseBufferTime: 5000,
  onSoftCloseError(error, context, req) {
    assertType(error)<unknown>();
    assertType(context)<string>();
    assertType(req)<IncomingMessage>();
  },
});
r.use(auth, requireAuthScope('foo'), (req) => {
  assertType(auth.getTokenData(req))<{ nbf: number; exp: number; scopes: string[]; extra: {} }>();
});

const nonTokenAuth = requireBearerAuth({
  realm: 'my realm',
  extractAndValidateToken: () => 'yep',
});
r.use(nonTokenAuth, (req) => {
  assertType(nonTokenAuth.getTokenData(req))<string>();
});

r.mount(
  '/:id',
  requireBearerAuth({
    realm: (req) => {
      return '';
    },
    extractAndValidateToken: () => true,
  }),
);

r.use((req, res) => {
  assertType(req)<IncomingMessage>();
  assertType(res)<ServerResponse>();

  emitError(req, 'nope');
  emitError(req, new Error());
  emitError(req, new Error(), 'custom context');
});

r.use(
  upgradeHandler((req, socket) => {
    assertType(req)<IncomingMessage>();
    assertType(socket)<Duplex>();
  }),
);

r.use(
  typedErrorHandler(TypeError, (error, _, res) => {
    assertType(error)<TypeError>();
    res.end('type error');
  }),
  typedErrorHandler(RangeError, (error, _, res) => {
    assertType(error)<RangeError>();
    res.end('range error');
  }),
  conditionalErrorHandler(
    (e) => typeof e === 'number',
    (error) => {
      assertType(error)<number>();
    },
  ),
  conditionalErrorHandler(
    (e) => e instanceof Error && e.message === 'oops',
    (error) => {
      assertType(error)<unknown>();
    },
  ),
  jsonErrorHandler((error) => ({ error: error.body, status: error.statusCode }), {
    forceStatus: 200,
    onlyIfRequested: false,
  }),
);

// @ts-expect-error
r.use(0);

const subRouter = new Router<WithPathParameters<{ foo: string }>>();
subRouter.within('/:a').get('/*b', (req, res) => {
  assertType(getPathParameters(req))<Readonly<{ foo: string; a: string; b: string[] }>>();
  res.write('response');
  res.end();
});
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

r.get('/:id/:2', async (req, res) => {
  const sse = new ServerSentEvents(req, res);
  const proxy = new EventSource('https://example.com');
  proxy.addEventListener('message', (ev) => {
    sse.send({ event: 'proxied', data: ev.data });
  });
  sse.signal.addEventListener('abort', () => proxy.close());
});

function negotiate() {
  for (const option of new Negotiator([]).options('foo.txt', {})) {
    assertType(option.filename)<string>();
    new Headers(option.headers);
    assertType(option.headers['content-type'])<string | undefined>();
  }
}

new WebListener(r).listen(8080, 'localhost');

// @ts-expect-error
new WebListener(subRouter);

// assertion helper
type Equals<A, B> =
  (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? [] : ['nope'];
const assertType =
  <Actual>(_: Actual) =>
  <Expected>(..._typesDoNotMatch: Equals<Actual, Expected>) => {};
