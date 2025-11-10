import { versionIsGreaterOrEqual } from '../test-helpers/versionIsGreaterOrEqual.mts';
import { withServer } from '../test-helpers/withServer.mts';
import { rawRequest } from '../test-helpers/rawRequest.mts';
import { responds } from '../test-helpers/responds.mts';
import { Router } from './Router.mts';
import { errorHandler, requestHandler, upgradeHandler, type HandlerResult } from './handler.mts';
import { CONTINUE, NEXT_ROUTE, NEXT_ROUTER, STOP } from './RoutingInstruction.mts';
import { HTTPError } from './HTTPError.mts';
import 'lean-test';

describe('router', () => {
  it('forwards requests to configured handlers', { timeout: 3000 }, () => {
    const router = new Router();
    router.use(testHandler);

    return withServer(router, async (url) => {
      await expect(
        fetch(url + '/foo'),
        responds({ status: 200, body: 'request - method: GET, handler URL: /foo' }),
      );

      await expect(
        fetch(url + '/foo', { method: 'POST' }),
        responds({ status: 200, body: 'request - method: POST, handler URL: /foo' }),
      );
    });
  });

  it('filters requests by path', { timeout: 3000 }, () => {
    const router = new Router();
    router.mount('/foo', testHandler);
    router.at('/exact', testHandler);

    return withServer(router, async (url) => {
      await expect(
        fetch(url + '/foo'),
        responds({ status: 200, body: 'request - method: GET, handler URL: /' }),
      );

      await expect(
        fetch(url + '/foo/bar'),
        responds({ status: 200, body: 'request - method: GET, handler URL: /bar' }),
      );

      await expect(
        fetch(url + '/exact'),
        responds({ status: 200, body: 'request - method: GET, handler URL: /' }),
      );

      await expect(fetch(url + '/exact/bar'), responds({ status: 404 }));
      await expect(fetch(url + '/nope'), responds({ status: 404 }));
      await expect(fetch(url + '/'), responds({ status: 404 }));
    });
  });

  it('checks paths in insertion order', { timeout: 3000 }, () => {
    const router = new Router();
    router.use(writeAndReturn('first;', false, CONTINUE));
    router.at('/foo', writeAndReturn('top'));
    router.at('/foo/bar', writeAndReturn('sub'));
    router.at('/foo/bar', writeAndReturn('ignored'));
    router.use(writeAndReturn('mid;', false, CONTINUE));
    router.at('/p/exact', writeAndReturn('exact'));
    router.at('/p/:wild', writeAndReturn('wild'));

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo'), responds({ body: 'first;top' }));
      await expect(fetch(url + '/foo/bar'), responds({ body: 'first;sub' }));
      await expect(fetch(url + '/p/any'), responds({ body: 'first;mid;wild' }));
      await expect(fetch(url + '/p/exact'), responds({ body: 'first;mid;exact' }));
    });
  });

  it('matches URL encoded paths', { timeout: 3000 }, () => {
    const router = new Router();
    router.at('/foo', testHandler);

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo'), responds({ status: 200 }));
      await expect(fetch(url + '/f%6f%6f'), responds({ status: 200 }));
    });
  });

  it('rejects malformed paths', { timeout: 3000 }, () => {
    return withServer(new Router(), async (url, { expectError }) => {
      await expect(fetch(url + '/fo%o'), responds({ status: 400, body: '' }));
      expectError('parsing request /fo%o: URIError: URI malformed');
    });
  });

  it('filters requests by method', { timeout: 3000 }, () => {
    const router = new Router();
    router.onRequest('GET', '/foo', testHandler);
    router.onRequest('POST', '/foo', writeAndReturn('posted'));

    return withServer(router, async (url) => {
      await expect(
        fetch(url + '/foo'),
        responds({ status: 200, body: 'request - method: GET, handler URL: /' }),
      );
      await expect(
        fetch(url + '/foo', { method: 'POST' }),
        responds({ status: 200, body: 'posted' }),
      );

      await expect(fetch(url + '/foo', { method: 'PUT' }), responds({ status: 404 }));
    });
  });

  it('chains handlers if CONTINUE is returned', { timeout: 3000 }, () => {
    const router = new Router();
    router.at('/foo', writeAndReturn('one;', false, CONTINUE), writeAndReturn('two;'));

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo'), responds({ body: 'one;two;' }));
    });
  });

  it('stops if a handler does not return CONTINUE', { timeout: 3000 }, () => {
    const router = new Router();
    router.at('/foo', writeAndReturn('one;'), writeAndReturn('two;'));

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo'), responds({ body: 'one;' }));
    });
  });

  it('uses all routes which match the request', { timeout: 3000 }, () => {
    const router = new Router();
    router.at('/foo/:any', writeAndReturn('one;', false, CONTINUE));
    router.at('/foo/a', writeAndReturn('a1;', false, NEXT_ROUTE), writeAndReturn('skipped;'));
    router.at(
      '/foo/a',
      writeAndReturn('a2;', false, CONTINUE),
      writeAndReturn('a3;', false, CONTINUE),
    );
    router.at('/foo/b', writeAndReturn('b;'));
    router.at('/foo/:any', writeAndReturn('end;'));

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo/a'), responds({ body: 'one;a1;a2;a3;end;' }));
      await expect(fetch(url + '/foo/b'), responds({ body: 'one;b;' }));
      await expect(fetch(url + '/foo/c'), responds({ body: 'one;end;' }));
    });
  });

  it('passes requests to matching sub-routers', { timeout: 3000 }, () => {
    const subRouter = new Router();
    subRouter.at('/:any', writeAndReturn('one;', false, CONTINUE));
    subRouter.at('/a', writeAndReturn('a;'));
    subRouter.at('/b', writeAndReturn('b;', false, NEXT_ROUTER));
    subRouter.at('/:any', writeAndReturn('end;'));

    const router = new Router();
    router.mount('/foo', subRouter);
    router.at('/foo/:any', writeAndReturn('outer;'));

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo/a'), responds({ body: 'one;a;' }));
      await expect(fetch(url + '/foo/b'), responds({ body: 'one;b;outer;' }));
      await expect(fetch(url + '/foo/c'), responds({ body: 'one;end;' }));
    });
  });

  it('recognises thrown routing instructions', { timeout: 3000 }, () => {
    const subRouter = new Router();
    subRouter.at('/:any', writeAndThrow('one;', false, CONTINUE));
    subRouter.at('/a', writeAndThrow('a;', true, STOP));
    subRouter.at('/b', writeAndThrow('b;', false, NEXT_ROUTER));
    subRouter.at('/:any', writeAndThrow('end;', true, STOP));

    const router = new Router();
    router.mount('/foo', subRouter);
    router.at('/foo/:any', writeAndReturn('outer;'));

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo/a'), responds({ body: 'one;a;' }));
      await expect(fetch(url + '/foo/b'), responds({ body: 'one;b;outer;' }));
      await expect(fetch(url + '/foo/c'), responds({ body: 'one;end;' }));
    });
  });

  it('sends an automatic error response if an error is thrown', { timeout: 3000 }, () => {
    const router = new Router();
    router.at('/foo', doThrow('oops'));

    return withServer(router, async (url, { expectError }) => {
      await expect(fetch(url + '/foo'), responds({ status: 500, body: '' }));
      expectError('handling request /foo: oops');
    });
  });

  it('uses details from HTTPError in automatic error response', { timeout: 3000 }, () => {
    const router = new Router();
    router.at('/foo', doThrow(new HTTPError(405, { body: 'oh no' })));

    return withServer(router, async (url, { expectError }) => {
      await expect(fetch(url + '/foo'), responds({ status: 405, body: 'oh no' }));
      expectError('handling request /foo: HTTPError(405 Method Not Allowed): oh no');
    });
  });

  it(
    'closes the connection if an unhandled error occurs after content is written',
    { timeout: 3000 },
    () => {
      const router = new Router();
      router.at('/foo', writeAndThrow('something', false, 'oops'));

      return withServer(router, async (url, { expectError }) => {
        await expect(fetch(url + '/foo'), responds({ body: 'something' }));
        expectError('handling request /foo: oops');
      });
    },
  );

  it('passes errors to the next error handler', { timeout: 3000 }, () => {
    const router = new Router();
    router.at(
      '/foo',
      writeAndReturn('begin;', false, CONTINUE),
      doThrow('oops'),
      writeAndReturn('skipped;'),
      errorHandler((error, _, out) => {
        out.response?.write(`error-handler:${error};`);
        return CONTINUE;
      }),
      writeAndReturn('end;'),
    );

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo'), responds({ body: 'begin;error-handler:oops;end;' }));
    });
  });

  it('stops handling errors once an error handler succeeds', { timeout: 3000 }, () => {
    let called = 0;
    const router = new Router();
    router.at(
      '/',
      doThrow('oops'),
      errorHandler(() => {
        throw 'also oops';
      }),
      errorHandler((error, _, out) => {
        out.response?.end(`error-handler:${error};`);
      }),
      errorHandler(() => {
        ++called;
      }),
    );

    return withServer(router, async (url) => {
      await expect(fetch(url), responds({ body: 'error-handler:also oops;' }));
      expect(called).equals(0);
    });
  });

  it('recognises thrown routing instructions in error handler', { timeout: 3000 }, () => {
    const router = new Router();
    router.at(
      '/foo',
      doThrow('oops'),
      errorHandler((error, _, out) => {
        out.response?.write(`error-handler:${error};`);
        throw CONTINUE;
      }),
      writeAndReturn('end;'),
    );

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo'), responds({ body: 'error-handler:oops;end;' }));
    });
  });

  it('uses error handlers registered with onError for all routes', { timeout: 3000 }, () => {
    const router = new Router();
    router.at(
      '/foo',
      writeAndReturn('foo;', false, CONTINUE),
      doThrow('oops'),
      writeAndReturn('skipped;'),
    );
    router.at('/bar', writeAndThrow('bar;', false, 'oh no'));
    router.onError(
      errorHandler((error, _, out) => {
        out.response?.end(`error-handler:${error};`);
      }),
    );

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo'), responds({ body: 'foo;error-handler:oops;' }));
      await expect(fetch(url + '/bar'), responds({ body: 'bar;error-handler:oh no;' }));
    });
  });

  it('provides convenience methods for common HTTP verbs', { timeout: 3000 }, () => {
    const router = new Router();
    router.delete('/', writeAndReturn('deleted'));
    router.get('/', writeAndReturn('got'));
    router.options('/', writeAndReturn('got options'));
    router.patch('/', writeAndReturn('patched'));
    router.post('/', writeAndReturn('posted'));
    router.put('/', writeAndReturn('put'));

    return withServer(router, async (url) => {
      await expect(fetch(url, { method: 'DELETE' }), responds({ body: 'deleted' }));
      await expect(fetch(url, { method: 'GET' }), responds({ body: 'got' }));
      await expect(fetch(url, { method: 'OPTIONS' }), responds({ body: 'got options' }));
      await expect(fetch(url, { method: 'PATCH' }), responds({ body: 'patched' }));
      await expect(fetch(url, { method: 'POST' }), responds({ body: 'posted' }));
      await expect(fetch(url, { method: 'PUT' }), responds({ body: 'put' }));
    });
  });

  it('falls back to GET handlers if no HEAD handler is available', { timeout: 3000 }, () => {
    const router = new Router();

    router.get('/without-head', writeAndReturn('my content'));

    // note: HEAD handler must be registered first
    router.head(
      '/with-head',
      requestHandler((_, res) => {
        res.statusCode = 299;
        res.end('head response body is ignored');
      }),
    );
    router.get('/with-head', writeAndReturn('my content'));

    return withServer(router, async (url) => {
      await expect(
        fetch(url + '/without-head', { method: 'HEAD' }),
        responds({ status: 200, body: '' }),
      );
      await expect(
        fetch(url + '/with-head', { method: 'HEAD' }),
        responds({ status: 299, body: '' }),
      );
    });
  });

  it('does not use getOnly routes for HEAD requests', { timeout: 3000 }, () => {
    const router = new Router();
    router.getOnly('/', writeAndReturn('content'));

    return withServer(router, async (url) => {
      await expect(fetch(url + '/', { method: 'GET' }), responds({ status: 200 }));
      await expect(fetch(url + '/', { method: 'HEAD' }), responds({ status: 404 }));
    });
  });

  it('accepts combined method and path strings in .on', { timeout: 3000 }, () => {
    const router = new Router();
    router.on('GET /', writeAndReturn('got /'));
    router.on('GET /foo', writeAndReturn('got /foo'));
    router.on('POST /foo', writeAndReturn('posted /foo'));

    return withServer(router, async (url) => {
      await expect(fetch(url), responds({ body: 'got /' }));
      await expect(fetch(url + '/foo'), responds({ body: 'got /foo' }));
      await expect(fetch(url + '/foo', { method: 'POST' }), responds({ body: 'posted /foo' }));
    });
  });

  it('registers sub-routers with .within', { timeout: 3000 }, () => {
    const router = new Router();
    router.within('/foo', (subRouter) => {
      subRouter.get('/bar', writeAndReturn('sub'));
    });

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo/bar'), responds({ body: 'sub' }));
      await expect(fetch(url + '/foo'), responds({ status: 404 }));
      await expect(fetch(url + '/foo/nope'), responds({ status: 404 }));
      await expect(fetch(url + '/nope/bar'), responds({ status: 404 }));
    });
  });

  it('accepts raw functions for handlers if the meaning is unambiguous', { timeout: 3000 }, () => {
    const router = new Router();
    router.get('/foo', (_, res) => void res.end('got foo'));
    router.get('/bar', () => {
      throw 'nope';
    });
    router.onError((err, _, out) => void out.response?.end('handled ' + err));

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo'), responds({ body: 'got foo' }));
      await expect(fetch(url + '/bar'), responds({ body: 'handled nope' }));
    });
  });

  it('awaits returned promises', { timeout: 3000 }, () => {
    const router = new Router();
    router.get(
      '/',
      (_, res) => {
        res.write('A');
        return new Promise<HandlerResult>((resolve) =>
          setTimeout(() => {
            res.write('B');
            resolve(CONTINUE);
          }, 10),
        );
      },
      writeAndReturn('C'),
    );

    return withServer(router, async (url) => {
      await expect(fetch(url), responds({ body: 'ABC' }));
    });
  });

  it('handles upgrades', { timeout: 3000 }, () => {
    const router = new Router();
    router.onUpgrade(
      'GET',
      'custom',
      '/',
      upgradeHandler((_, socket) => void socket.end('raw socket response')),
    );

    return withServer(router, async (url) => {
      const response = await rawRequest(url, {
        headers: { connection: 'upgrade', upgrade: 'custom' },
      });
      expect(response).equals('raw socket response');
    });
  });

  it('uses request handling for routes without an upgrade handler', { timeout: 3000 }, () => {
    assume(process.version, versionIsGreaterOrEqual('24.9'));

    const router = new Router();
    router.onUpgrade(
      'GET',
      'custom',
      '/foo',
      upgradeHandler((_, socket) => void socket.end('raw socket response')),
    );
    router.onRequest('GET', '/bar', writeAndReturn('request handler'));

    return withServer(router, async (url) => {
      const response1 = await rawRequest(url + '/foo', {
        headers: { connection: 'upgrade', upgrade: 'custom' },
      });
      expect(response1).equals('raw socket response');

      const response2 = await rawRequest(url + '/bar', {
        headers: { connection: 'upgrade', upgrade: 'custom' },
      });
      expect(response2).contains('request handler');
    });
  });

  it('uses request handling for unrecognised upgrade protocols', { timeout: 3000 }, () => {
    assume(process.version, versionIsGreaterOrEqual('24.9'));

    const router = new Router();
    router.onUpgrade(
      'GET',
      'known',
      '/',
      upgradeHandler((_, socket) => void socket.end('raw socket response')),
    );
    router.onRequest('GET', '/', writeAndReturn('request handler'));

    return withServer(router, async (url) => {
      // known upgrade
      const response1 = await rawRequest(url, {
        headers: { connection: 'upgrade', upgrade: 'known' },
      });
      expect(response1).equals('raw socket response');

      // unknown upgrade
      const response2 = await rawRequest(url, {
        headers: { connection: 'upgrade', upgrade: 'unknown' },
      });
      expect(response2).contains('request handler');

      // no upgrade
      const response3 = await rawRequest(url);
      expect(response3).contains('request handler');
    });
  });

  it('routes upgrade errors to error handlers', { timeout: 3000 }, () => {
    const router = new Router();
    router.onUpgrade(
      'GET',
      'custom',
      '/',
      upgradeHandler((_, socket) => {
        socket.write('A;');
        throw 'oops';
      }),
    );
    router.onError((error, _, out) => {
      out.socket?.end(`error-handler:${error};`);
    });

    return withServer(router, async (url) => {
      const response = await rawRequest(url, {
        headers: { connection: 'upgrade', upgrade: 'custom' },
      });
      expect(response).equals('A;error-handler:oops;');
    });
  });

  it('returns 404 for upgrade requests which are not handled', { timeout: 3000 }, () => {
    const router = new Router().onUpgrade('GET', 'custom', '/', () => CONTINUE);

    return withServer(router, async (url) => {
      const response = await rawRequest(url, {
        headers: { connection: 'upgrade', upgrade: 'custom' },
      });
      expect(response).equals(
        'HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n',
      );
    });
  });

  it('calls return handlers with values returned from request handlers', { timeout: 3000 }, () => {
    const router = new Router();
    router.onReturn((value, _, res) => {
      res.end(`returned ${JSON.stringify(value)}`);
    });
    router.get('/', () => ({ foo: 'bar' }));

    return withServer(router, async (url) => {
      await expect(fetch(url), responds({ status: 200, body: 'returned {"foo":"bar"}' }));
    });
  });

  it('calls all return handlers sequentially', { timeout: 3000 }, () => {
    const router = new Router();
    router.onReturn(async (_value, _req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      res.write('A');
    });
    router.onReturn((_value, _req, res) => {
      res.end(`B`);
    });
    router.get('/', () => {});

    return withServer(router, async (url) => {
      await expect(fetch(url), responds({ status: 200, body: 'AB' }));
    });
  });

  it('does not call return handlers for routing instructions', { timeout: 3000 }, () => {
    let called = 0;
    const router = new Router();
    router.onReturn(() => {
      ++called;
    });
    router.get(
      '/',
      () => CONTINUE,
      () => NEXT_ROUTE,
    );
    router.get('/', writeAndReturn('done'));

    return withServer(router, async (url) => {
      await expect(fetch(url), responds({ status: 200, body: 'done' }));
      expect(called).equals(1);
    });
  });

  it('does not call return handlers for upgrades', { timeout: 3000 }, () => {
    let called = 0;
    const router = new Router();
    router.onReturn(() => {
      ++called;
    });
    router.onUpgrade(
      'GET',
      'custom',
      '/',
      upgradeHandler((_, socket) => {
        socket.end('raw socket response');
        return { foo: 'bar' };
      }),
    );

    return withServer(router, async (url) => {
      const response = await rawRequest(url, {
        headers: { connection: 'upgrade', upgrade: 'custom' },
      });
      expect(response).equals('raw socket response');
      expect(called).equals(0);
    });
  });

  it('does not call return handlers for errors', { timeout: 3000 }, () => {
    let called = 0;
    const router = new Router();
    router.onReturn(() => {
      ++called;
    });
    router.get('/', writeAndThrow('message', true, 'oops'));

    return withServer(router, async (url, { expectError }) => {
      await expect(fetch(url), responds({ status: 200, body: 'message' }));
      expect(called).equals(0);
      expectError('handling request /: oops');
    });
  });

  it('calls subsequent error handlers if a return handler throws', { timeout: 3000 }, () => {
    const router = new Router();
    router.onReturn((value) => {
      if (value) {
        throw 'oops';
      }
    });
    router.get(
      '/',
      errorHandler((err, _, res) => {
        res.response?.end(`should not be called: ${err}`);
      }),
      () => ({ foo: 'bar' }),
      errorHandler((err, _, res) => {
        res.response?.end(`error-handler:${err}`);
      }),
    );

    return withServer(router, async (url) => {
      await expect(fetch(url), responds({ status: 200, body: 'error-handler:oops' }));
    });
  });

  it('calls return handlers with values returned from error handlers', { timeout: 3000 }, () => {
    const router = new Router();
    router.onReturn((value, _, res) => {
      res.end(`returned ${JSON.stringify(value)}`);
    });
    router.get(
      '/',
      () => {
        throw 'oops';
      },
      errorHandler((error) => ({ error })),
    );

    return withServer(router, async (url) => {
      await expect(fetch(url), responds({ status: 200, body: 'returned {"error":"oops"}' }));
    });
  });

  it('calls return handlers for all relevant routers in the chain', { timeout: 3000 }, () => {
    const router = new Router();
    router.onReturn((value, _, res) => {
      res.end(`outer ${JSON.stringify(value)};`);
    });
    const subRouter = new Router();
    subRouter.onReturn((value, _, res) => {
      res.write(`inner ${JSON.stringify(value)};`);
    });
    subRouter.get('/', () => ({ foo: 'bar' }));
    router.use(subRouter);

    return withServer(router, async (url) => {
      await expect(fetch(url), responds({ body: 'inner {"foo":"bar"};outer {"foo":"bar"};' }));
    });
  });
});

const testHandler = requestHandler(
  (req, res) => void res.end(`request - method: ${req.method}, handler URL: ${req.url}`),
);

const doThrow = (err: unknown) =>
  requestHandler(() => {
    throw err;
  });

const writeAndReturn = (message: string, end = true, response: HandlerResult = undefined) =>
  requestHandler((_, res) => {
    if (end) {
      res.end(message);
    } else {
      res.write(message);
    }
    return response;
  });

const writeAndThrow = (message: string, end: boolean, error: unknown) =>
  requestHandler((_, res) => {
    if (end) {
      res.end(message);
    } else {
      res.write(message);
    }
    throw error;
  });
