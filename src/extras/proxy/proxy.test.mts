import { createServer as httpsCreateServer } from 'node:https';
import { request, type IncomingMessage } from 'node:http';
import { text } from 'node:stream/consumers';
import { withServer } from '../../test-helpers/withServer.mts';
import { responds } from '../../test-helpers/responds.mts';
import { makeStreamSearch } from '../../test-helpers/streamSearch.mts';
import { rawRequest, rawRequestStream } from '../../test-helpers/rawRequest.mts';
import { generateTLSConfig } from '../../test-helpers/generateTLSConfig.mts';
import { disableProtoDelete, disableProtoThrow } from '../../test-helpers/proto.mts';
import { getAddressURL } from '../../util/getAddressURL.mts';
import { requestHandler } from '../../core/handler.mts';
import { getAbortSignal } from '../../core/close.mts';
import { proxy } from './proxy.mts';
import 'lean-test';

describe('proxy', () => {
  it('forwards requests to another server', { timeout: 3000 }, () => {
    const upstream = requestHandler((req, res) => {
      res.end(`upstream handling ${req.method} ${req.url}`);
    });

    return withServer(upstream, (upstreamUrl) =>
      withServer(proxy(upstreamUrl), async (url) => {
        await expect(fetch(url), responds({ body: 'upstream handling GET /' }));
        await expect(fetch(url + '/'), responds({ body: 'upstream handling GET /' }));
        await expect(fetch(url + '/foo'), responds({ body: 'upstream handling GET /foo' }));
        await expect(fetch(url + '/foo/%25'), responds({ body: 'upstream handling GET /foo/%25' }));
        await expect(
          fetch(url + '//foo//bar'),
          responds({ body: 'upstream handling GET //foo//bar' }),
        );
      }),
    );
  });

  it('supports https connections', { timeout: 3000 }, async () => {
    const upstreamServer = httpsCreateServer(await generateTLSConfig(), (req, res) => {
      res.end(`secure upstream handling ${req.method} ${req.url}`);
    });
    await new Promise<void>((resolve) => upstreamServer.listen(0, 'localhost', resolve));
    try {
      const handler = proxy(getAddressURL(upstreamServer.address(), 'https'), {
        rejectUnauthorized: false, // test certificate is self-signed
      });
      await withServer(handler, async (url) => {
        await expect(fetch(url), responds({ body: 'secure upstream handling GET /' }));
      });
    } finally {
      await new Promise<void>((resolve) => upstreamServer.close(() => resolve()));
    }
  });

  it('streams request and response data', { timeout: 3000 }, () => {
    const upstream = requestHandler((req, res) => {
      res.statusCode = 246;
      res.statusMessage = 'Echoing';
      res.flushHeaders();
      res.write(`echo ${req.method}:`);
      req.pipe(res);
    });

    return withServer(upstream, (upstreamUrl) =>
      withServer(proxy(upstreamUrl), async (url) => {
        const requestStream = new TransformStream();
        const requestWriter = requestStream.writable.getWriter();
        requestWriter.write(Buffer.from('chunk1'));
        const socket = await rawRequestStream(url, {
          method: 'POST',
          body: requestStream.readable,
        });

        const received = makeStreamSearch(socket, fail);

        await received.find('246 Echoing');
        await received.find('echo POST:');
        await received.find('chunk1');
        await requestWriter.write(Buffer.from('chunk2'));
        await received.find('chunk2');
        await requestWriter.write(Buffer.from('chunk3'));
        await requestWriter.close();
        await received.find('chunk3');
        await received.expectEnd();
        expect(received.current()).not(contains('100 Continue'));
      }),
    );
  });

  it('sends 100 Continue if requested', { timeout: 3000 }, () => {
    const upstream = requestHandler((req, res) => {
      res.statusCode = 246;
      res.statusMessage = 'Echoing';
      res.flushHeaders();
      res.write(`echo ${req.method}:`);
      req.pipe(res);
    });

    return withServer(upstream, (upstreamUrl) =>
      withServer(proxy(upstreamUrl), async (url) => {
        const requestStream = new TransformStream();
        const requestWriter = requestStream.writable.getWriter();
        const socket = await rawRequestStream(url, {
          method: 'POST',
          headers: { expect: '100-continue' },
          body: requestStream.readable,
        });

        const received = makeStreamSearch(socket, fail);

        await received.find('100 Continue');
        await requestWriter.write(Buffer.from('data'));
        await requestWriter.close();
        await received.find('246 Echoing');
        await received.find('data');
        await received.expectEnd();
      }),
    );
  });

  it('forwards headers except per-hop headers', { timeout: 3000 }, () => {
    const upstream = requestHandler((req, res) => {
      res.writeHead(200, {
        Connection: 'x-custom-Hop-response, Foobar',
        Etag: '"my-etag"',
        'X-custom-hop-response': 'secret',
        'X-custom-response': 'Another thing',
      });
      const raw = req.rawHeaders;
      for (let i = 0; i < raw.length; i += 2) {
        res.write(`${raw[i]}: ${raw[i + 1]}\n`);
      }
      res.end();
    });

    return withServer(upstream, (upstreamUrl) =>
      withServer(proxy(upstreamUrl), async (url) => {
        const req = request(url, {
          headers: {
            Connection: 'x-custom-Hop-request, bleh',
            Expect: 'CustomExpectation',
            'Proxy-authorization': 'secret',
            Via: 'this',
            'X-custom-hop-request': 'secret',
            'X-custom-request': 'Something',
            'User-agent': 'me',
          },
        });
        req.end();
        const res = await new Promise<IncomingMessage>((resolve, reject) => {
          req.once('response', resolve);
          req.once('error', reject);
        });
        expect(res.headers['etag']).equals('"my-etag"');
        expect(res.headers['x-custom-response']).equals('Another thing');
        expect(res.headers['x-custom-hop-response']).isUndefined();
        expect(res.headers['x-custom-request']).isUndefined();
        expect(res.headers['connection']).equals('keep-alive');
        expect(res.headers['via']).isUndefined();

        const body = await text(res);
        const reflectedHeaders = body.split('\n');
        expect(reflectedHeaders).contains('x-custom-request: Something');
        expect(reflectedHeaders).contains('user-agent: me');
        expect(reflectedHeaders).contains('Connection: keep-alive');
        expect(reflectedHeaders.some((h) => h.includes('proxy-authentication:'))).isFalse();
        expect(reflectedHeaders.some((h) => h.includes('via:'))).isFalse();
        expect(reflectedHeaders.some((h) => h.includes('x-custom-hop-request:'))).isFalse();
      }),
    );
  });

  it(
    'handles malicious header names',
    { timeout: 3000 },
    // delete rather than throw for this test, because Node.js internals for header parsing trigger access if a header is named __proto__
    disableProtoDelete(() => {
      const upstream = requestHandler((req, res) => {
        res.writeHead(
          200,
          Object.fromEntries([
            ['__proto__', 'foo-out'],
            ['constructor', 'bar-out'],
          ]),
        );
        const raw = req.rawHeaders;
        for (let i = 0; i < raw.length; i += 2) {
          res.write(`${raw[i]}: ${raw[i + 1]}\n`);
        }
        res.end();
      });

      return withServer(upstream, (upstreamUrl) =>
        withServer(proxy(upstreamUrl), async (url) => {
          const req = request(url, {
            headers: Object.fromEntries([
              ['__proto__', 'foo-in'],
              ['constructor', 'bar-in'],
            ]),
          });
          req.end();
          const res = await new Promise<IncomingMessage>((resolve, reject) => {
            req.once('response', resolve);
            req.once('error', reject);
          });
          expect(res.headers['__proto__']).equals('foo-out');
          expect(res.headers['constructor']).equals('bar-out');

          const body = await text(res);
          const reflectedHeaders = body.split('\n');
          expect(reflectedHeaders).contains('__proto__: foo-in');
          expect(reflectedHeaders).contains('constructor: bar-in');
        }),
      );
    }),
  );

  it(
    'handles malicious connection header values',
    { timeout: 3000 },
    disableProtoThrow(() => {
      const upstream = requestHandler((req, res) => {
        res.writeHead(200, { Connection: '__proto__, constructor' });
        const raw = req.rawHeaders;
        for (let i = 0; i < raw.length; i += 2) {
          res.write(`${raw[i]}: ${raw[i + 1]}\n`);
        }
        res.end();
      });

      return withServer(upstream, (upstreamUrl) =>
        withServer(proxy(upstreamUrl), async (url) => {
          const req = request(url, { headers: { Connection: '__proto__, constructor' } });
          req.end();
          const res = await new Promise<IncomingMessage>((resolve, reject) => {
            req.once('response', resolve);
            req.once('error', reject);
          });
          expect(res.headers['connection']).equals('keep-alive');

          const body = await text(res);
          const reflectedHeaders = body.split('\n');
          expect(reflectedHeaders).contains('Connection: keep-alive');
        }),
      );
    }),
  );

  it('allows proxying to a specific subpath', { timeout: 3000 }, () => {
    const upstream = requestHandler((req, res) => {
      res.end(`upstream handling ${req.method} ${req.url}`);
    });

    return withServer(upstream, (upstreamUrl) =>
      withServer(proxy(upstreamUrl + '/nested'), async (url) => {
        await expect(fetch(url), responds({ body: 'upstream handling GET /nested/' }));
        await expect(fetch(url + '/foo'), responds({ body: 'upstream handling GET /nested/foo' }));
        await expect(
          fetch(url + '//foo//bar'),
          responds({ body: 'upstream handling GET /nested//foo//bar' }),
        );
      }),
    );
  });

  it('blocks directory traversal attacks', { timeout: 3000 }, () => {
    const upstream = requestHandler((req, res) => {
      res.end(`upstream handling ${req.method} ${req.url}`);
    });

    return withServer(upstream, (upstreamUrl) =>
      withServer(proxy(upstreamUrl + '/nested'), async (url, { expectError }) => {
        expect(await rawRequest(url + '/foo')).contains('upstream handling GET /nested/foo');

        expect(await rawRequest(url + '/..')).contains('400 Bad Request');
        expectError(
          'handling request /..: HTTPError(400 Bad Request): directory traversal blocked',
        );
        expect(await rawRequest(url + '/../nested2')).contains('400 Bad Request');
        expectError(
          'handling request /../nested2: HTTPError(400 Bad Request): directory traversal blocked',
        );
        expect(await rawRequest(url + '/a/../b')).contains('upstream handling GET /nested/b');
        expect(await rawRequest(url + '/.')).contains('upstream handling GET /nested/');
        expect(await rawRequest(url + '/%2e%2e')).contains('400 Bad Request');
        expectError(
          'handling request /%2e%2e: HTTPError(400 Bad Request): directory traversal blocked',
        );

        expect(await rawRequest(url + '/http://other:80/a')).contains(
          'upstream handling GET /nested/http://other:80/a',
        );

        expect(await rawRequest(url + '/%00/a')).contains('upstream handling GET /nested/%00/a');

        expect(await rawRequest(url + '/http://example.com')).contains(
          'upstream handling GET /nested/http://example.com',
        );

        expect(await rawRequest(url + '//http://example.com')).contains(
          'upstream handling GET /nested//http://example.com',
        );
      }),
    );
  });

  it('cancels the upstream request if the request is aborted', { timeout: 3000 }, () => {
    let upstreamSignal: AbortSignal | undefined;
    const upstream = requestHandler((req) => {
      upstreamSignal = getAbortSignal(req);
    });

    return withServer(upstream, (upstreamUrl) =>
      withServer(proxy(upstreamUrl), async (url) => {
        const ac = new AbortController();
        const req = fetch(url, { signal: ac.signal }).catch(() => {});
        await expect.poll(() => upstreamSignal, not(isUndefined()), { timeout: 300 });
        ac.abort();
        await req;
        await expect.poll(() => upstreamSignal?.aborted, isTrue(), { timeout: 300 });
      }),
    );
  });
});
