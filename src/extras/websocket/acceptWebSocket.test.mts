import { WebSocketServer } from 'ws';
import { withServer } from '../../test-helpers/withServer.mts';
import { makeWebSocketConnection } from '../../test-helpers/makeWebSocketConnection.mts';
import { versionIsGreaterOrEqual } from '../../test-helpers/versionIsGreaterOrEqual.mts';
import { requestHandler, upgradeHandler } from '../../core/handler.mts';
import { HTTPError } from '../../core/HTTPError.mts';
import { WebSocketError } from './WebSocketError.mts';
import { makeAcceptWebSocket } from './acceptWebSocket.mts';
import 'lean-test';

describe('acceptWebSocket', () => {
  it('wraps a provided ws server implementation', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const handler = upgradeHandler(async (req) => {
      const ws = await acceptWebSocket(req);
      ws.send('hello');
      ws.on('message', (data) => {
        const message = data.toString('utf-8');
        ws.send(`echo ${message}`);
      });
    });

    return withServer(handler, async (url) => {
      const { ws, next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      expect(await next()).equals('MESSAGE: hello');
      ws.send('poke');
      expect(await next()).equals('MESSAGE: echo poke');
      ws.close();
      expect(await next()).equals('CLOSED: 1005 ');
      await closed();
    });
  });

  it('does not need to be called immediately', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const handler = upgradeHandler(async (req) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const ws = await acceptWebSocket(req);
      ws.send('hello');
    });

    return withServer(handler, async (url) => {
      const { ws, next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      expect(await next()).equals('MESSAGE: hello');
      ws.close();
      await closed();
    });
  });

  it('sets up error handling for WebSocketError', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const handler = upgradeHandler(async (req) => {
      await acceptWebSocket(req);
      throw new WebSocketError(4567, { statusMessage: 'oh no', message: 'private' });
    });

    return withServer(handler, async (url, { expectError }) => {
      const { next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      expect(await next()).equals('CLOSED: 4567 oh no');
      expectError('handling upgrade /: WebSocketError(4567 oh no): private');
      await closed();
    });
  });

  it('maps HTTPError to 4xxx close codes', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const handler = upgradeHandler(async (req) => {
      await acceptWebSocket(req);
      throw new HTTPError(400, { statusMessage: 'oh no', message: 'private' });
    });

    return withServer(handler, async (url, { expectError }) => {
      const { next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      expect(await next()).equals('CLOSED: 4400 oh no');
      expectError('handling upgrade /: HTTPError(400 oh no): private');
      await closed();
    });
  });

  it('maps HTTPError 5xx to server error close code', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const handler = upgradeHandler(async (req) => {
      await acceptWebSocket(req);
      throw new HTTPError(599, { statusMessage: 'oh no', message: 'private' });
    });

    return withServer(handler, async (url, { expectError }) => {
      const { next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      expect(await next()).equals('CLOSED: 1011 oh no');
      expectError('handling upgrade /: HTTPError(599 oh no): private');
      await closed();
    });
  });

  it('sets up soft close handling', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const handler = upgradeHandler(async (req) => {
      await acceptWebSocket(req);
    });

    return withServer(handler, async (url, { listeners }) => {
      const { next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      listeners.softClose('soft closing', (error) => fail(String(error)));
      expect(await next()).equals('CLOSED: 1001 soft closing');
      await closed();
    });
  });

  it('fails if called from a request handler', { timeout: 3000 }, () => {
    assume(process.version, versionIsGreaterOrEqual('24.9'));

    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const handler = requestHandler(async (req) => {
      await acceptWebSocket(req);
    });

    return withServer(handler, async (url, { expectError }) => {
      const { next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('ERROR');
      expect(await next()).equals('CLOSED: 1006 ');
      expectError('handling request /: Error: not an upgrade request');
      await closed();
    });
  });
});
