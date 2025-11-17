import { Router } from '../../core/Router.mts';
import { withServer } from '../../test-helpers/withServer.mts';
import { hasAuthScope, requireAuthScope, requireBearerAuth } from './bearer.mts';
import 'lean-test';

const testTokenValidator = (token: string): unknown => {
  if (token.startsWith('valid-')) {
    return JSON.parse(token.substring(6));
  }
  if (token.startsWith('throw-')) {
    throw new Error(token.substring(6));
  }
  return null;
};

const testAuth = requireBearerAuth({
  realm: 'some-realm',
  extractAndValidateToken: testTokenValidator,
});

describe('requireBearerAuth', () => {
  function runTest(fetchInit: RequestInit, expectedStatus: number, expectedCalled = false) {
    let called = false;
    const router = new Router();
    router.use(testAuth.handler);
    router.get('/', (_, res) => {
      called = true;
      res.end('content');
    });

    return withServer(router, async (url, { expectError }) => {
      const res = await fetch(url, fetchInit);
      expect(res.status).equals(expectedStatus);
      expect(called).equals(expectedCalled);
      if (!expectedCalled) {
        expectError('HTTPError');
      }
    });
  }

  it('rejects unauthenticated requests', () => runTest({}, 401));

  it('rejects unknown authentication schemes', () =>
    runTest({ headers: { authorization: 'Foo valid-{}' } }, 401));

  it('rejects invalid authentication', () =>
    runTest({ headers: { authorization: 'Bearer invalid-{}' } }, 401));

  it('wraps errors thrown during token validation', () =>
    runTest({ headers: { authorization: 'Bearer error-oops' } }, 401));

  it('accepts valid authentication', () =>
    runTest({ headers: { authorization: 'Bearer valid-{}' } }, 200, true));

  it('rejects expired tokens', () =>
    runTest({ headers: { authorization: 'Bearer valid-{"exp": 1}' } }, 401));

  it('rejects tokens which are not valid yet', () => {
    const future = Math.ceil(Date.now() / 1000) + 10;
    return runTest({ headers: { authorization: `Bearer valid-{"nbf": ${future}}` } }, 401);
  });

  it('allows tokens which expire in the future', () => {
    const future = Math.ceil(Date.now() / 1000) + 10;
    return runTest({ headers: { authorization: `Bearer valid-{"exp": ${future}}` } }, 200, true);
  });

  it('optionally closes connections when their authentication expires', { timeout: 3000 }, () => {
    const router = new Router();
    router.get(
      '/',
      requireBearerAuth({
        realm: 'some-realm',
        extractAndValidateToken: testTokenValidator,
        closeOnExpiry: true,
      }).handler,
      () => {},
    );

    return withServer(router, async (url) => {
      // token only allows 1-second resolution, so this test might be slow
      const nearFuture = Math.floor(Date.now() / 1000 + 1.5);
      const res = await fetch(url, {
        headers: { authorization: `Bearer valid-{"exp": ${nearFuture}}` },
      });
      expect(res.status).equals(503);
    });
  });

  it('uses custom token fetching if no bearer token is sent', { timeout: 3000 }, () => {
    const router = new Router();
    router.get(
      '/',
      requireBearerAuth({
        realm: 'some-realm',
        extractAndValidateToken: testTokenValidator,
        fallbackTokenFetcher: (req) => String(req.headers['x-custom-auth']),
      }).handler,
      (_, res) => void res.end('content'),
    );

    return withServer(router, async (url, { expectError }) => {
      const res1 = await fetch(url, {
        headers: { 'x-custom-auth': 'valid-{}' },
      });
      expect(res1.status).equals(200);

      const res2 = await fetch(url, {
        headers: { 'x-custom-auth': 'invalid-{}' },
      });
      expect(res2.status).equals(401);
      expectError('handling request /: HTTPError(401 Unauthorized): invalid token');

      // prefers authorization header if present
      const res3 = await fetch(url, {
        headers: { authorization: 'Bearer invalid-{}', 'x-custom-auth': 'valid-{}' },
      });
      expect(res3.status).equals(401);
      expectError('handling request /: HTTPError(401 Unauthorized): invalid token');
    });
  });
});

describe('requireAuthScope', () => {
  function runTest(fetchInit: RequestInit, expectedStatus: number, expectedCalled = false) {
    let called = false;
    const router = new Router();
    router.use(testAuth.handler);
    router.get('/', requireAuthScope('my-scope'), (_, res) => {
      called = true;
      res.end('content');
    });

    return withServer(router, async (url, { expectError }) => {
      const res = await fetch(url, fetchInit);
      expect(res.status).equals(expectedStatus);
      expect(called).equals(expectedCalled);
      if (!expectedCalled) {
        expectError('HTTPError');
      }
    });
  }

  it('rejects users without required scope', () =>
    runTest({ headers: { authorization: 'Bearer valid-{}' } }, 403));

  it('accepts users with required scope', () =>
    runTest(
      { headers: { authorization: 'Bearer valid-{"scopes":{"my-scope":true}}' } },
      200,
      true,
    ));
});

describe('getTokenData', () => {
  it('returns the parsed token data', () => {
    const router = new Router();
    router.get('/', testAuth.handler, (req, res) => {
      res.end(`getTokenData: ${JSON.stringify(testAuth.getTokenData(req))}`);
    });

    return withServer(router, async (url) => {
      const res = await fetch(url, { headers: { authorization: 'Bearer valid-{"foo":"bar"}' } });
      expect(await res.text()).equals('getTokenData: {"foo":"bar"}');
    });
  });

  it('throws if no token data is available', () => {
    const router = new Router();
    router.get('/', (req, res) => {
      res.end(`getTokenData: ${JSON.stringify(testAuth.getTokenData(req))}`);
    });

    return withServer(router, async (url, { expectError }) => {
      const res = await fetch(url, { headers: { authorization: 'Bearer valid-{"foo":"bar"}' } });
      expect(res.status).equals(500);
      expect(await res.text()).equals('');
      expectError(
        'handling request /: TypeError: cannot use getTokenData in an unauthenticated endpoint',
      );
    });
  });
});

describe('hasAuthScope', () => {
  function runTest(path: string, fetchInit: RequestInit, expectedBody: string) {
    const router = new Router();
    router.get('/authenticated', testAuth.handler, (req, res) => {
      res.end(`hasAuthScope s1: ${hasAuthScope(req, 's1')}`);
    });
    router.get('/unauthenticated', (req, res) => {
      res.end(`hasAuthScope s1: ${hasAuthScope(req, 's1')}`);
    });

    return withServer(router, async (url) => {
      const res = await fetch(url + path, fetchInit);
      expect(res.status).equals(200);
      expect(await res.text()).equals(expectedBody);
    });
  }

  it('returns true if the user has the requested scope via dictionary', () =>
    runTest(
      '/authenticated',
      { headers: { authorization: 'Bearer valid-{"scopes":{"s1":true}}' } },
      'hasAuthScope s1: true',
    ));

  it('returns true if the user has the requested scope via list', () =>
    runTest(
      '/authenticated',
      { headers: { authorization: 'Bearer valid-{"scopes":["s1"]}' } },
      'hasAuthScope s1: true',
    ));

  it('returns false if the requested scope is not set', () =>
    runTest(
      '/authenticated',
      { headers: { authorization: 'Bearer valid-{"scopes":["other"]}' } },
      'hasAuthScope s1: false',
    ));

  it('returns false if no scopes are set', () =>
    runTest(
      '/authenticated',
      { headers: { authorization: 'Bearer valid-{"scopes":[]}' } },
      'hasAuthScope s1: false',
    ));

  it('returns false if the request is not authenticated', () =>
    runTest('/unauthenticated', {}, 'hasAuthScope s1: false'));
});
