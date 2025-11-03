import { WebSocketServer } from 'ws';
import { withServer } from '../../test-helpers/withServer.mts';
import { rawRequest } from '../../test-helpers/rawRequest.mts';
import { makeWebSocketConnection } from '../../test-helpers/makeWebSocketConnection.mts';
import { anyHandler, requestHandler } from '../../core/handler.mts';
import { Router } from '../../core/Router.mts';
import { getAuthData, requireBearerAuth } from '../auth/bearer.mts';
import { makeAcceptWebSocket } from './acceptWebSocket.mts';
import {
  getWebSocketOrigin,
  isWebSocketRequest,
  makeWebSocketFallbackTokenFetcher,
} from './helpers.mts';
import 'lean-test';

describe('isWebSocketRequest', () => {
  it('returns true for valid websocket upgrade requests', { timeout: 3000 }, () => {
    let result: unknown;
    const handler = anyHandler(
      (req, res) => {
        result = isWebSocketRequest(req);
        res.end();
      },
      () => true,
    );

    return withServer(handler, async (url) => {
      const ws = new WebSocket(url);
      await new Promise((resolve) => ws.addEventListener('close', resolve));
      expect(result).equals(true);
    });
  });

  it('returns false for unrelated upgrade requests', { timeout: 3000 }, () => {
    let result: unknown;
    const handler = anyHandler(
      (req, res) => {
        result = isWebSocketRequest(req);
        res.end();
      },
      () => true,
    );

    return withServer(handler, async (url) => {
      await rawRequest(url, { headers: { connection: 'upgrade', upgrade: 'other' } });
      expect(result).equals(false);

      await rawRequest(url, {
        method: 'POST',
        headers: { connection: 'upgrade', upgrade: 'websocket' },
      });
      expect(result).equals(false);

      await rawRequest(url, { headers: { upgrade: 'websocket' } });
      expect(result).equals(false);

      await rawRequest(url, {});
      expect(result).equals(false);
    });
  });

  it('returns false for upgrades handled as requests', { timeout: 3000 }, () => {
    let result: unknown;
    const handler = requestHandler((req, res) => {
      result = isWebSocketRequest(req);
      res.end();
    });

    return withServer(handler, async (url) => {
      await rawRequest(url, { headers: { connection: 'upgrade', upgrade: 'websocket' } });
      expect(result).equals(false);
    });
  });
});

describe('getWebSocketOrigin', () => {
  it('returns the origin for the request', () => {
    let result: unknown;
    const handler = anyHandler(
      (req, res) => {
        result = getWebSocketOrigin(req);
        res.end();
      },
      () => true,
    );

    return withServer(handler, async (url) => {
      await rawRequest(url, {
        headers: { connection: 'upgrade', upgrade: 'websocket', origin: 'here' },
      });
      expect(result).equals('here');
    });
  });

  it('returns the legacy sec-websocket-origin if origin is not present', () => {
    let result: unknown;
    const handler = anyHandler(
      (req, res) => {
        result = getWebSocketOrigin(req);
        res.end();
      },
      () => true,
    );

    return withServer(handler, async (url) => {
      await rawRequest(url, {
        headers: { connection: 'upgrade', upgrade: 'websocket', 'sec-websocket-origin': 'here' },
      });
      expect(result).equals('here');
    });
  });
});

describe('makeWebSocketFallbackTokenFetcher', () => {
  it('returns a function compatible with requireBearerAuth', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const router = new Router();
    router.ws(
      '/',
      requireBearerAuth({
        realm: 'some-realm',
        extractAndValidateToken: testTokenValidator,
        fallbackTokenFetcher: makeWebSocketFallbackTokenFetcher(acceptWebSocket),
      }),
      async (req) => {
        const ws = await acceptWebSocket(req);
        ws.on('message', (data) => {
          const message = data.toString('utf-8');
          ws.send(`echo ${message}`);
        });
        ws.send('hello ' + JSON.stringify(getAuthData(req)));
      },
    );

    return withServer(router, async (url) => {
      const { ws, next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      ws.send('valid-{"foo":"bar"}');
      expect(await next()).equals('MESSAGE: hello {"foo":"bar"}');
      ws.send('message');
      expect(await next()).equals('MESSAGE: echo message');
      ws.close();
      await closed();
    });
  });

  it('does not error if the connection closes before details are sent', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const router = new Router();
    router.ws(
      '/',
      requireBearerAuth({
        realm: 'some-realm',
        extractAndValidateToken: testTokenValidator,
        fallbackTokenFetcher: makeWebSocketFallbackTokenFetcher(acceptWebSocket),
      }),
      async (req) => {
        const ws = await acceptWebSocket(req);
        ws.send('hello ' + JSON.stringify(getAuthData(req)));
      },
    );

    return withServer(router, async (url) => {
      const { ws, next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      ws.close();
      await closed();
    });
  });

  it('times out if the client does not authenticate quickly enough', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const router = new Router();
    router.ws(
      '/',
      requireBearerAuth({
        realm: 'some-realm',
        extractAndValidateToken: testTokenValidator,
        fallbackTokenFetcher: makeWebSocketFallbackTokenFetcher(acceptWebSocket, 100),
      }),
      async (req) => {
        const ws = await acceptWebSocket(req);
        ws.send('hello ' + JSON.stringify(getAuthData(req)));
        ws.close();
      },
    );

    return withServer(router, async (url, { expectError }) => {
      const { next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      expect(await next()).equals('CLOSED: 1008 timeout waiting for authentication token');
      expectError(
        'handling upgrade /: WebSocketError(1008 timeout waiting for authentication token)',
      );
      await closed();
    });
  });
});

const testTokenValidator = (token: string) => {
  if (token.startsWith('valid-')) {
    return JSON.parse(token.substring(6));
  }
  return null;
};
