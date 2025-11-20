import { openRawSocket, rawRequest } from '../test-helpers/rawRequest.mts';
import { makeStreamSearch } from '../test-helpers/streamSearch.mts';
import { withServer } from '../test-helpers/withServer.mts';
import { acceptUpgrade, delegateUpgrade } from './acceptUpgrade.mts';
import { requestHandler, upgradeHandler } from './handler.mts';
import 'lean-test';

describe('acceptUpgrade', () => {
  it('invokes the given handler', { timeout: 3000 }, () => {
    const handler = upgradeHandler(async (req) => {
      const returned = await acceptUpgrade(req, async (_, socket) => {
        socket.write('upgrading\n');
        return {
          return: { complete: () => void socket.end('completed') },
          onError: () => void socket.end('errored'),
        };
      });
      returned.complete();
    });

    return withServer(handler, async (url) => {
      const response = await rawRequest(url, {
        headers: { connection: 'upgrade', upgrade: 'custom' },
      });
      expect(response).equals('upgrading\ncompleted');
    });
  });

  it('returns existing results if called again', { timeout: 3000 }, () => {
    const handler = upgradeHandler(async (req) => {
      await acceptUpgrade(req, async (_, socket) => {
        socket.write('upgrading 1\n');
        return {
          return: { complete: () => void socket.end('completed 1') },
          onError: () => void socket.end('errored 1'),
        };
      });
      const returned = await acceptUpgrade(req, async (_, socket) => {
        socket.write('upgrading 2\n');
        return {
          return: { complete: () => void socket.end('completed 2') },
          onError: () => void socket.end('errored 2'),
        };
      });
      returned.complete();
    });

    return withServer(handler, async (url) => {
      const response = await rawRequest(url, {
        headers: { connection: 'upgrade', upgrade: 'custom' },
      });
      expect(response).equals('upgrading 1\ncompleted 1');
    });
  });

  it('does nothing if the request has already been cancelled', { timeout: 3000 }, () => {
    let called = false;
    const handler = upgradeHandler(async (req, socket) => {
      socket.end();
      await acceptUpgrade(req, async () => {
        called = true;
        return { return: null };
      });
    });

    return withServer(handler, async (url) => {
      const parsedURL = new URL(url);
      const socket = await openRawSocket(parsedURL);
      const received = makeStreamSearch(socket, fail);

      socket.end('GET / HTTP/1.1\r\nconnection: upgrade\r\nupgrade: custom\r\n\r\n');
      await received.expectEnd();
      expect(received.current()).equals('');
      expect(called).isFalse();
    });
  });

  it('uses the returned error handler if unhandled errors are thrown', { timeout: 3000 }, () => {
    const handler = upgradeHandler(async (req) => {
      await acceptUpgrade(req, async (_, socket) => {
        socket.write('upgrading\n');
        return {
          return: null,
          onError: (error) => void socket.end(`errored: ${error}`),
        };
      });

      throw 'oops';
    });

    return withServer(handler, async (url, { expectError }) => {
      const response = await rawRequest(url, {
        headers: { connection: 'upgrade', upgrade: 'custom' },
      });
      expect(response).equals('upgrading\nerrored: oops');
      expectError('handling upgrade /: oops');
    });
  });

  it('registers the returned soft close handler', { timeout: 3000 }, () => {
    let connected = false;
    const handler = upgradeHandler(async (req) => {
      await acceptUpgrade(req, async (_, socket) => {
        connected = true;
        socket.write('upgrading\n');
        return {
          return: null,
          softCloseHandler: (reason) => void socket.end(`soft close: ${reason}`),
        };
      });
    });

    return withServer(handler, async (url, { listeners }) => {
      const request = rawRequest(url, {
        headers: { connection: 'upgrade', upgrade: 'custom' },
      });
      await expect.poll(() => connected, isTrue(), { timeout: 500 });
      listeners.softClose('going away', (error) => fail(String(error)));
      const response = await request;
      expect(response).equals('upgrading\nsoft close: going away');
    });
  });

  it('rejects calls from request handlers', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req) => {
      await acceptUpgrade(req, async (_, socket) => {
        socket.write('upgrading\n');
        return {
          return: null,
          onError: (error) => void socket.end(`errored: ${error}`),
        };
      });
    });

    return withServer(handler, async (url, { expectError }) => {
      const response = await rawRequest(url);
      expect(response).contains('500 Internal Server Error');
      expectError('handling request /: TypeError: not an upgrade request');
    });
  });

  it('rejects requests which have already been delegated', { timeout: 3000 }, () => {
    const handler = upgradeHandler(async (req) => {
      delegateUpgrade(req);
      await acceptUpgrade(req, async () => ({ return: null }));
    });

    return withServer(handler, async (url, { expectError }) => {
      const response = await rawRequest(url, {
        headers: { connection: 'upgrade', upgrade: 'custom' },
      });
      expect(response).equals('');
      expectError('handling upgrade /: TypeError: upgrade already delegated');
    });
  });
});

describe('delegateUpgrade', () => {
  it('prevents automatic errors being sent on the connection', { timeout: 3000 }, () => {
    const handler = upgradeHandler(async (req, socket) => {
      delegateUpgrade(req);
      socket.write('custom');
      throw new Error('oops');
    });

    return withServer(handler, async (url, { expectError }) => {
      const response = await rawRequest(url, {
        headers: { connection: 'upgrade', upgrade: 'custom' },
      });
      expect(response).equals('custom');
      expectError('handling upgrade /: Error: oops');
    });
  });

  it('rejects repeated calls', { timeout: 3000 }, () => {
    const handler = upgradeHandler((req) => {
      delegateUpgrade(req);
      delegateUpgrade(req);
    });

    return withServer(handler, async (url, { expectError }) => {
      const response = await rawRequest(url, {
        headers: { connection: 'upgrade', upgrade: 'custom' },
      });
      expect(response).equals('');
      expectError('handling upgrade /: TypeError: upgrade already handled');
    });
  });

  it('rejects calls from request handlers', { timeout: 3000 }, () => {
    const handler = requestHandler((req) => {
      delegateUpgrade(req);
    });

    return withServer(handler, async (url, { expectError }) => {
      const response = await rawRequest(url);
      expect(response).contains('500 Internal Server Error');
      expectError('handling request /: TypeError: not an upgrade request');
    });
  });
});
