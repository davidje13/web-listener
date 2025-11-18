import { createServer } from 'node:http';
import { versionIsGreaterOrEqual } from '../test-helpers/versionIsGreaterOrEqual.mts';
import { rawRequest } from '../test-helpers/rawRequest.mts';
import { responds } from '../test-helpers/responds.mts';
import { getAddressURL } from '../util/getAddressURL.mts';
import { requestHandler, upgradeHandler } from './handler.mts';
import { setSoftCloseHandler } from './close.mts';
import { WebListener } from './WebListener.mts';
import '../polyfill/fetch.mts';
import 'lean-test';

describe('WebListener', () => {
  describe('listen', () => {
    it('launches a server for the handler', { timeout: 3000 }, async () => {
      const handler = requestHandler((req, res) => {
        res.end(`reply for ${req.url}`);
      });
      const weblistener = new WebListener(handler);
      const server = await weblistener.listen(0, 'localhost');
      const url = getAddressURL(server.address());
      try {
        await expect(
          fetch(url + '/foo/bar'),
          responds({ status: 200, body: 'reply for /foo/bar' }),
        );
      } finally {
        await server.closeWithTimeout('end of test', 0);
      }
    });

    it('listens for upgrade requests', { timeout: 3000 }, async () => {
      const handler = upgradeHandler((req, socket) => {
        socket.end(`my custom protocol reply for ${req.url}`);
      });
      const weblistener = new WebListener(handler);
      const server = await weblistener.listen(0, 'localhost');
      const url = getAddressURL(server.address());
      try {
        const response = await rawRequest(url + '/foo/bar', {
          headers: { connection: 'upgrade', upgrade: 'custom' },
        });
        expect(response).equals('my custom protocol reply for /foo/bar');
      } finally {
        await server.closeWithTimeout('end of test', 0);
      }
    });

    it('filters upgrade requests using shouldUpgrade', { timeout: 3000 }, async () => {
      assume(process.version, versionIsGreaterOrEqual('24.9'));

      const weblistener = new WebListener({
        handleRequest(_, res) {
          res.end('handled as request');
        },
        handleUpgrade(_, socket) {
          socket.end('handled as upgrade');
        },
        shouldUpgrade(req) {
          return Boolean(req.url?.startsWith('/upgrade'));
        },
      });
      const server = await weblistener.listen(0, 'localhost');
      const url = getAddressURL(server.address());
      try {
        const response1 = await rawRequest(url + '/upgrade', {
          headers: { connection: 'upgrade', upgrade: 'custom' },
        });
        expect(response1).equals('handled as upgrade');

        const response2 = await rawRequest(url + '/other', {
          headers: { connection: 'upgrade', upgrade: 'custom' },
        });
        expect(response2).contains('handled as request');
      } finally {
        await server.closeWithTimeout('end of test', 0);
      }
    });

    it('rejects custom expect requests by default', { timeout: 3000 }, async () => {
      const handler = requestHandler((req, res) => {
        res.end(`expected ${req.headers.expect}`);
      });
      const weblistener = new WebListener(handler);
      const server = await weblistener.listen(0, 'localhost');
      const url = getAddressURL(server.address());
      try {
        const response = await rawRequest(url, { headers: { expect: 'custom' } });
        expect(response).contains('417 Expectation Failed');
        expect(response).not(contains('expected '));
      } finally {
        await server.closeWithTimeout('end of test', 0);
      }
    });

    it('responds to custom expect requests if configured', { timeout: 3000 }, async () => {
      const handler = requestHandler((req, res) => {
        res.end(`expected ${req.headers.expect}`);
      });
      const weblistener = new WebListener(handler);
      const server = await weblistener.listen(0, 'localhost', { rejectNonStandardExpect: false });
      const url = getAddressURL(server.address());
      try {
        const response = await rawRequest(url, { headers: { expect: 'custom' } });
        expect(response).contains('200 OK');
        expect(response).contains('expected custom');
      } finally {
        await server.closeWithTimeout('end of test', 0);
      }
    });

    it('sends 100 Continue if requested by default', { timeout: 3000 }, async () => {
      const handler = requestHandler((_, res) => {
        res.end('handler content');
      });
      const weblistener = new WebListener(handler);
      const server = await weblistener.listen(0, 'localhost');
      const url = getAddressURL(server.address());
      try {
        const response = await rawRequest(url, {
          method: 'POST',
          headers: { expect: '100-Continue' },
        });
        expect(response).contains('100 Continue');
        expect(response).contains('handler content');
      } finally {
        await server.closeWithTimeout('end of test', 0);
      }
    });

    it('allows custom 100 Continue handling if configured', { timeout: 3000 }, async () => {
      const handler = requestHandler((req, res) => {
        if (req.url === '/yes') {
          res.writeContinue();
        }
        res.end('handler content');
      });
      const weblistener = new WebListener(handler);
      const server = await weblistener.listen(0, 'localhost', { autoContinue: false });
      const url = getAddressURL(server.address());
      try {
        const response1 = await rawRequest(url + '/yes', {
          method: 'POST',
          headers: { expect: '100-Continue' },
        });
        expect(response1).contains('100 Continue');
        expect(response1).contains('handler content');

        const response2 = await rawRequest(url + '/no', {
          method: 'POST',
          headers: { expect: '100-Continue' },
        });
        expect(response2).not(contains('100 Continue'));
        expect(response2).contains('handler content');
      } finally {
        await server.closeWithTimeout('end of test', 0);
      }
    });

    it('soft closes connections when closeWithTimeout is called', { timeout: 3000 }, async () => {
      const events: string[] = [];
      const handler = requestHandler((req, res) => {
        events.push('received');
        setSoftCloseHandler(req, (reason) => {
          events.push('soft close called: ' + reason);
          res.end('soft closed');
        });
      });

      const weblistener = new WebListener(handler);
      const server = await weblistener.listen(0, 'localhost');
      const url = getAddressURL(server.address());
      try {
        const req = fetch(url).catch(fail);
        await expect.poll(() => events, equals(['received']), { timeout: 500 });
        await server.closeWithTimeout('shutdown', 5000);
        expect(events).equals(['received', 'soft close called: shutdown']);
        const res = await req;
        expect(res!.status).equals(200);
        expect(res!.headers.get('connection')).equals('close');
        expect(await res!.text()).equals('soft closed');
      } finally {
        await server.closeWithTimeout('end of test', 0);
      }
    });

    it('hard closes connections which do not soft close in time', { timeout: 3000 }, async () => {
      const events: string[] = [];
      const handler = requestHandler((req) => {
        events.push('received');
        setSoftCloseHandler(req, (reason) => {
          events.push('soft close called: ' + reason);
        });
      });

      const weblistener = new WebListener(handler);
      const server = await weblistener.listen(0, 'localhost');
      const url = getAddressURL(server.address());
      try {
        const req = fetch(url).catch(fail);
        await expect.poll(() => events, equals(['received']), { timeout: 500 });
        await server.closeWithTimeout('shutdown', 50);
        expect(events).equals(['received', 'soft close called: shutdown']);
        const res = await req;
        expect(res!.status).equals(503);
        expect(res!.headers.get('connection')).equals('close');
        expect(await res!.text()).equals('');
      } finally {
        await server.closeWithTimeout('end of test', 0);
      }
    });

    it('closes connections which have not made any request', { timeout: 3000 }, async () => {
      const handler = requestHandler(() => {});

      const weblistener = new WebListener(handler);
      const server = await weblistener.listen(0, 'localhost');
      const url = getAddressURL(server.address());
      try {
        const input = new TransformStream<Uint8Array>();
        const madeConnection = new Promise((resolve) => server.once('connection', resolve));
        const request = fetch(url, { method: 'POST', body: input.readable, duplex: 'half' }).catch(
          (err) => String(err),
        );
        await madeConnection;
        await server.closeWithTimeout('shutdown', 50);
        const res = await request;
        expect(res).equals('TypeError: fetch failed');
      } finally {
        await server.closeWithTimeout('end of test', 0);
      }
    });

    it('allows new connections while soft closing', { timeout: 3000 }, async () => {
      const closers: (() => void)[] = [];
      const handler = requestHandler((req, res) => {
        setSoftCloseHandler(req, () => {
          res.write('soft closed');
        });
        closers.push(() => res.end());
      });

      const weblistener = new WebListener(handler);
      const server = await weblistener.listen(0, 'localhost');
      const url = getAddressURL(server.address());
      try {
        const req1 = fetch(url)
          .then((r) => r.text())
          .catch(fail);
        await expect.poll(() => closers, hasLength(1), { timeout: 500 });

        const closed = server.closeWithTimeout('shutdown', 5000);

        const req2 = fetch(url)
          .then((r) => r.text())
          .catch(fail);
        await expect.poll(() => closers, hasLength(2), { timeout: 500 });

        closers[1]!();
        expect(await req2).equals('soft closed');

        closers[0]!();
        expect(await req1).equals('soft closed');

        await closed; // after closing, subsequent requests fail
        await expect(() => fetch(url)).throws('fetch failed');
      } finally {
        await server.closeWithTimeout('end of test', 0);
      }
    });
  });

  describe('createServer', () => {
    it('creates a server with listeners attached', { timeout: 3000 }, async () => {
      const handler = requestHandler((req, res) => {
        res.end(`reply for ${req.url}`);
      });
      const weblistener = new WebListener(handler);
      const server = weblistener.createServer();
      expect(server.address()).isNull();

      await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
      const url = getAddressURL(server.address());
      try {
        await expect(
          fetch(url + '/foo/bar'),
          responds({ status: 200, body: 'reply for /foo/bar' }),
        );
      } finally {
        await server.closeWithTimeout('end of test', 0);
      }
    });
  });

  describe('attach', () => {
    it('attaches the WebListener to an existing server', { timeout: 3000 }, async () => {
      const server = createServer();
      await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
      try {
        const url = getAddressURL(server.address());
        const initialListeners = SERVER_EVENTS.map((event) => ({
          event,
          count: server.listenerCount(event),
        }));

        const weblistener1 = new WebListener(
          requestHandler((req, res) => void res.end(`reply 1 for ${req.url}`)),
        );
        const detach1 = weblistener1.attach(server);
        await expect(fetch(url + '/foo/bar'), responds({ body: 'reply 1 for /foo/bar' }));
        detach1();

        const weblistener2 = new WebListener(
          requestHandler((req, res) => void res.end(`reply 2 for ${req.url}`)),
        );
        const detach2 = weblistener2.attach(server);
        await expect(fetch(url + '/foo/bar'), responds({ body: 'reply 2 for /foo/bar' }));
        detach2();

        for (const { event, count } of initialListeners) {
          expect(server.listenerCount(event)).withMessage(
            `dangling listeners for ${event}`,
            equals(count),
          );
        }
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
          server.closeAllConnections();
        });
      }
    });

    it('soft closes connections when detach is called', { timeout: 3000 }, async () => {
      const server = createServer();
      await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
      const url = getAddressURL(server.address());

      const events: string[] = [];
      const handler = requestHandler((req, res) => {
        events.push('received');
        setSoftCloseHandler(req, (reason) => {
          events.push('soft close called: ' + reason);
          res.end('soft closed');
        });
      });

      try {
        const weblistener = new WebListener(handler);
        const detach = weblistener.attach(server);
        const req = fetch(url).catch(fail);
        await expect.poll(() => events, equals(['received']), { timeout: 500 });
        detach('shutdown', 5000);

        const res = await req;
        expect(res!.status).equals(200);
        expect(res!.headers.get('connection')).equals('close');
        expect(await res!.text()).equals('soft closed');
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
          server.closeAllConnections();
        });
      }
    });
  });

  describe('error handling', () => {
    it('emits an "error" event if a handler errors', { timeout: 3000 }, async () => {
      const handler = requestHandler(() => {
        throw new Error('oops');
      });
      const weblistener = new WebListener(handler);
      const capturedErrors: any[] = [];
      weblistener.addEventListener('error', (ev) => {
        ev.preventDefault();
        capturedErrors.push((ev as CustomEvent).detail);
      });
      const server = await weblistener.listen(0, 'localhost');
      const url = getAddressURL(server.address());
      try {
        await expect(fetch(url), responds({ status: 500 }));
      } finally {
        await server.closeWithTimeout('end of test', 0);
      }
      expect(capturedErrors).hasLength(1);
      expect(capturedErrors[0].error).equals(new Error('oops'));
      expect(capturedErrors[0].server).equals(server);
    });
  });
});

const SERVER_EVENTS = [
  'close',
  'connection',
  'error',
  'listening',
  'checkContinue',
  'checkExpectation',
  'clientError',
  'connect',
  'dropRequest',
  'request',
  'upgrade',
];
