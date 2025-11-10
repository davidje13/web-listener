import { makeRequestOnSocket, openRawSocket } from '../test-helpers/rawRequest.mts';
import { makeStreamSearch } from '../test-helpers/streamSearch.mts';
import { withServer } from '../test-helpers/withServer.mts';
import { HTTPError } from './HTTPError.mts';
import { CONTINUE } from './RoutingInstruction.mts';
import { upgradeHandler } from './handler.mts';
import { Router } from './Router.mts';
import 'lean-test';

describe('keep-alive', () => {
  it('allows multiple requests on the same socket', { timeout: 3000 }, () => {
    const router = new Router();
    router.get('/one', (_, res) => void res.end('first'));
    router.get('/two', (_, res) => void res.end('second'));

    return withServer(router, async (url) => {
      const parsedURL = new URL(url);
      const socket = await openRawSocket(parsedURL);
      const received = makeStreamSearch(socket, fail);

      makeRequestOnSocket(socket, parsedURL.host, '/one', {
        headers: { connection: 'keep-alive' },
      });
      await received.find('200 OK');
      await received.find('first');

      makeRequestOnSocket(socket, parsedURL.host, '/two', {
        headers: { connection: 'keep-alive' },
      });

      await received.find('second');
      socket.end();
      await received.expectEnd();
    });
  });

  it('allows multiple requests after an error', { timeout: 3000 }, () => {
    const router = new Router();
    router.get('/one', () => {
      throw new HTTPError(400);
    });
    router.get('/two', (_, res) => void res.end('second'));

    return withServer(router, async (url, { expectError }) => {
      const parsedURL = new URL(url);
      const socket = await openRawSocket(parsedURL);
      const received = makeStreamSearch(socket, fail);

      makeRequestOnSocket(socket, parsedURL.host, '/one', {
        headers: { connection: 'keep-alive' },
      });
      await received.find('400 Bad Request');
      expectError('handling request /one: HTTPError(400 Bad Request)');

      makeRequestOnSocket(socket, parsedURL.host, '/two', {
        headers: { connection: 'keep-alive' },
      });

      await received.find('second');
      socket.end();
      await received.expectEnd();
    });
  });

  it('rejects malformed request lines and closes the socket', () => {
    const router = new Router();
    router.get('/one', (_, res) => void res.end('first'));

    return withServer(router, async (url, { expectError }) => {
      const parsedURL = new URL(url);
      const socket = await openRawSocket(parsedURL);
      const received = makeStreamSearch(socket, fail);

      socket.write('/one HTTP/1.1\r\ncontent-length: 0\r\n\r\n');
      await received.find('400 Bad Request');
      await received.find('connection: close');
      await received.expectEnd();
      expectError('Parse Error: Invalid method encountered');
    });
  });

  it('rejects malformed headers and closes the socket', () => {
    const router = new Router();
    router.get('/one', (_, res) => void res.end('first'));

    return withServer(router, async (url, { expectError }) => {
      const parsedURL = new URL(url);
      const socket = await openRawSocket(parsedURL);
      const received = makeStreamSearch(socket, fail);

      socket.write('GET /one HTTP/1.1\r\nnope\r\n\r\n');
      await received.find('400 Bad Request');
      await received.find('connection: close');
      await received.expectEnd();
      expectError('Parse Error: Invalid header token');
    });
  });

  it('stops and closes the socket if the body closes early', () => {
    const router = new Router();
    router.post('/one', (_, res) => void res.end('first'));

    return withServer(router, async (url) => {
      const parsedURL = new URL(url);
      const socket = await openRawSocket(parsedURL, { allowHalfOpen: true });
      const received = makeStreamSearch(socket, fail);

      socket.end(
        `POST /one HTTP/1.1\r\nhost: ${parsedURL.host}\r\ncontent-length: 10\r\n\r\ncontent`,
      );
      await received.find('200 OK');
      await received.expectEnd();
      // in this scenario, we end up sending a 400 response after the 200 response
      // (because our handler does not attempt to read the body, so has already
      // returned before the end of body error)
    });
  });

  it('does not allow further requests after an attempted upgrade', { timeout: 3000 }, () => {
    const router = new Router();
    router.onUpgrade('GET', 'foobar', '/one', () => CONTINUE);

    return withServer(router, async (url) => {
      const parsedURL = new URL(url);
      const socket = await openRawSocket(parsedURL);
      const received = makeStreamSearch(socket, fail);

      makeRequestOnSocket(socket, parsedURL.host, '/one', {
        headers: { connection: 'upgrade, keep-alive', upgrade: 'foobar' },
      });
      await received.find('404 Not Found');
      await received.expectEnd();
    });
  });
});

describe('upgrade closing', () => {
  it('prevents clients holding a socket half open', { timeout: 3000 }, () => {
    const handler = upgradeHandler((_, socket) => void socket.end());

    return withServer(
      handler,
      async (url, { listeners }) => {
        const parsedURL = new URL(url);
        const socket = await openRawSocket(parsedURL, { allowHalfOpen: true });
        makeRequestOnSocket(socket, parsedURL.host, '/', {
          headers: { connection: 'upgrade', upgrade: 'custom' },
        });
        socket.on('data', () => {});
        await new Promise((resolve) => socket.on('end', resolve));
        expect(listeners.countConnections()).equals(1);

        // dangling socket should be destroyed by server after a short delay:
        await expect.poll(() => listeners.countConnections(), equals(0), { timeout: 300 });
      },
      { socketCloseTimeout: 100 },
    );
  });
});
