import { requestHandler } from '../index.mts';
import { makeTestTempDir } from '../test-helpers/makeFileStructure.mts';
import { responds } from '../test-helpers/responds.mts';
import { withServer } from '../test-helpers/withServer.mts';
import { buildRouter, type LogInfo } from './buildRouter.mts';
import 'lean-test';

describe('buildRouter', () => {
  describe('files', () => {
    const TEST_DIR = makeTestTempDir('br-', { 'file.txt': 'Content' });

    it('adds file server middleware', { timeout: 3000 }, async ({ getTyped }) => {
      const router = await buildRouter([
        { type: 'files', dir: getTyped(TEST_DIR), path: '/', options: {} },
      ]);
      return withServer(router, async (url) => {
        await expect(fetch(url + '/file.txt'), responds({ body: 'Content' }));
      });
    });
  });

  describe('proxy', () => {
    it('adds proxy middleware', { timeout: 3000 }, () => {
      const upstream = requestHandler((req, res) => {
        res.end(`upstream handling ${req.method} ${req.url}`);
      });

      return withServer(upstream, async (upstreamUrl) => {
        const router = await buildRouter([
          { type: 'proxy', target: upstreamUrl, path: '/', options: {} },
        ]);
        return withServer(router, async (url) => {
          await expect(fetch(url), responds({ body: 'upstream handling GET /' }));
        });
      });
    });
  });

  describe('fixture', () => {
    it('adds fixtures', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'fixture',
          method: 'GET',
          path: '/',
          status: 299,
          headers: { foo: 'bar' },
          body: 'Hi',
        },
        {
          type: 'fixture',
          method: 'POST',
          path: '/2',
          status: 200,
          headers: {},
          body: 'Reply',
        },
      ]);
      return withServer(router, async (url) => {
        await expect(fetch(url), responds({ status: 299, headers: { foo: 'bar' }, body: 'Hi' }));
        await expect(
          fetch(url + '/2', { method: 'POST' }),
          responds({ status: 200, body: 'Reply' }),
        );
      });
    });

    it('supports basic templating', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'fixture',
          method: 'GET',
          path: '/:p1/*p2',
          status: 200,
          headers: { foo: 'pre-${p1}-post' },
          body: 'Got ${p1:-blank} ${p2:-blank} ${p3:-blank} ${?q1:-blank}',
        },
      ]);
      return withServer(router, async (url) => {
        await expect(
          fetch(url + '/foo/bar'),
          responds({ headers: { foo: 'pre-foo-post' }, body: 'Got foo bar blank blank' }),
        );
        await expect(
          fetch(url + '/foo/bar/baz?q1=zig'),
          responds({ body: 'Got foo bar/baz blank zig' }),
        );
      });
    });
  });

  describe('redirect', () => {
    it('adds redirects', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'redirect',
          path: '/attempt',
          status: 307,
          target: '/other',
        },
        {
          type: 'fixture',
          method: 'GET',
          path: '/other',
          status: 200,
          headers: {},
          body: 'Redirected content',
        },
      ]);
      return withServer(router, async (url) => {
        await expect(
          fetch(url + '/attempt', { redirect: 'manual' }),
          responds({ status: 307, headers: { location: '/other' }, body: '' }),
        );
        await expect(
          fetch(url + '/attempt'),
          responds({ status: 200, headers: {}, body: 'Redirected content' }),
        );
        await expect(
          fetch(url + '/attempt', { method: 'POST', redirect: 'manual' }),
          responds({ status: 307, headers: { location: '/other' }, body: '' }),
        );
      });
    });

    it('supports basic templating', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'redirect',
          path: '/*route.html',
          status: 301,
          target: '/${route}.htm${?}',
        },
      ]);
      return withServer(router, async (url) => {
        await expect(
          fetch(url + '/file.html', { redirect: 'manual' }),
          responds({ status: 301, headers: { location: '/file.htm' } }),
        );
        await expect(
          fetch(url + '/nested/file.html', { redirect: 'manual' }),
          responds({ status: 301, headers: { location: '/nested/file.htm' } }),
        );
        await expect(
          fetch(url + '/file.html?query=string', { redirect: 'manual' }),
          responds({ status: 301, headers: { location: '/file.htm?query=string' } }),
        );
      });
    });
  });

  it('logs requests', { timeout: 3000 }, async () => {
    const events: LogInfo[] = [];
    const router = await buildRouter(
      [{ type: 'fixture', method: 'GET', path: '/', status: 200, headers: {}, body: 'Hi' }],
      (info) => events.push(info),
    );
    return withServer(router, async (url, { expectError }) => {
      await fetch(url);
      expect(events).hasLength(1);
      expect(events[0]?.method).equals('GET');
      expect(events[0]?.path).equals('/');
      expect(events[0]?.status).equals(200);

      await fetch(url + '/nope', { method: 'PUT' });
      expect(events).hasLength(2);
      expect(events[1]?.method).equals('PUT');
      expect(events[1]?.path).equals('/nope');
      expect(events[1]?.status).equals(404);
      expectError('handling request /nope: HTTPError(404 Not Found)');
    });
  });
});
