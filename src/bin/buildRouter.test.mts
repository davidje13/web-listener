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
        { type: 'files', dir: getTyped(TEST_DIR), path: '/', options: {} as any },
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
          { type: 'proxy', target: upstreamUrl, path: '/', options: {} as any },
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
  });

  it('logs requests', { timeout: 3000 }, async () => {
    const events: LogInfo[] = [];
    const router = await buildRouter(
      [{ type: 'fixture', method: 'GET', path: '/', status: 200, headers: {}, body: 'Hi' }],
      (info) => events.push(info),
    );
    return withServer(router, async (url) => {
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
    });
  });
});
