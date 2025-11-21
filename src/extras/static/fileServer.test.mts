import { makeTestTempDir } from '../../test-helpers/makeFileStructure.mts';
import { withServer } from '../../test-helpers/withServer.mts';
import { rawRequest } from '../../test-helpers/rawRequest.mts';
import { requestHandler } from '../../core/handler.mts';
import { Router } from '../../core/Router.mts';
import { negotiateEncoding } from '../request/negotiation.mts';
import { fileServer } from './fileServer.mts';
import 'lean-test';

describe('fileServer', () => {
  const TEST_DIR = makeTestTempDir('ff-', {
    'file.txt': 'Content',
    'file.txt.gz': 'Compressed',
    'index.htm': 'Root Index',
    sub: {
      'index.html': 'Sub Index',
    },
    none: {},
  });

  it('serves files from the filesystem', { timeout: 3000 }, async ({ getTyped }) => {
    const handler = await fileServer(getTyped(TEST_DIR));

    return withServer(handler, async (url) => {
      const res = await fetch(url + '/file.txt');
      expect(res.status).equals(200);
      expect(res.headers.get('content-type')).equals('text/plain; charset=utf-8');
      expect(res.headers.get('etag')!).startsWith('W/\"');
      expect(res.headers.get('last-modified')).not(isNull());
      expect(await res.text()).equals('Content');

      const resHEAD = await fetch(url + '/file.txt', { method: 'HEAD' });
      expect(resHEAD.status).equals(200);
      expect(resHEAD.headers.get('content-type')).equals('text/plain; charset=utf-8');
      expect(resHEAD.headers.get('etag')).equals(res.headers.get('etag'));
      expect(resHEAD.headers.get('last-modified')).equals(res.headers.get('last-modified'));
      expect(await resHEAD.text()).equals('');
    });
  });

  it(
    'serves index pages when directories are requested',
    { timeout: 3000 },
    async ({ getTyped }) => {
      const handler = await fileServer(getTyped(TEST_DIR));

      return withServer(handler, async (url, { expectError }) => {
        const res1 = await fetch(url);
        expect(res1.status).equals(200);
        expect(await res1.text()).equals('Root Index');

        const res2 = await fetch(url + '/sub');
        expect(res2.status).equals(200);
        expect(await res2.text()).equals('Sub Index');

        const res3 = await fetch(url + '/sub/');
        expect(res3.status).equals(200);
        expect(await res3.text()).equals('Sub Index');

        const res4 = await fetch(url + '/none/');
        expect(res4.status).equals(404);
        expect(await res4.text()).equals('');
        expectError('handling request /none/: HTTPError(404 Not Found)');
      });
    },
  );

  it('supports content negotiation', { timeout: 3000 }, async ({ getTyped }) => {
    const handler = await fileServer(getTyped(TEST_DIR), {
      negotiation: [negotiateEncoding(['gzip'])],
    });

    return withServer(handler, async (url) => {
      const res1 = await rawRequest(url + '/file.txt');
      expect(res1).contains('Content');
      expect(res1).contains('vary: accept-encoding');

      const res2 = await rawRequest(url + '/file.txt', { headers: { 'accept-encoding': 'gzip' } });
      expect(res2).contains('Compressed');
      expect(res2).contains('content-encoding: gzip');
      expect(res2).contains('vary: accept-encoding');
    });
  });

  it('continues to next route for unknown files', { timeout: 3000 }, async ({ getTyped }) => {
    const router = new Router();
    router.use(await fileServer(getTyped(TEST_DIR)));
    router.use(requestHandler((_, res) => res.end('nope')));

    return withServer(router, async (url) => {
      const res = await fetch(url + '/missing');
      expect(await res.text()).equals('nope');
    });
  });

  it('reports verbose error information if configured', { timeout: 3000 }, async ({ getTyped }) => {
    const router = new Router();
    router.use(await fileServer(getTyped(TEST_DIR), { verbose: true }));
    router.use(requestHandler((_, res) => res.end('nope')));

    return withServer(router, async (url, { expectError }) => {
      const res = await fetch(url + '/missing');
      expect(await res.text()).equals('nope');
      expectError(/serving static content \/missing: Error: file ".*" does not exist/);
    });
  });

  it('ignores non-GET/HEAD requests', { timeout: 3000 }, async ({ getTyped }) => {
    const router = new Router();
    router.use(await fileServer(getTyped(TEST_DIR)));
    router.use(requestHandler((req, res) => res.end(`fallback ${req.method}`)));

    return withServer(router, async (url) => {
      const res = await fetch(url + '/file.txt', { method: 'POST' });
      expect(await res.text()).equals('fallback POST');
    });
  });

  it('falls back to a specific file if configured', { timeout: 3000 }, async ({ getTyped }) => {
    const router = new Router();
    router.use(
      await fileServer(getTyped(TEST_DIR), {
        fallback: { filePath: 'file.txt', statusCode: 255 },
        negotiation: [negotiateEncoding(['gzip'])],
      }),
    );
    router.use(requestHandler((_, res) => res.end('nope')));

    return withServer(router, async (url) => {
      const res1 = await fetch(url + '/missing', { headers: { 'accept-encoding': 'identity' } });
      expect(res1.status).equals(255);
      expect(await res1.text()).equals('Content');

      const res2 = await rawRequest(url + '/missing', { headers: { 'accept-encoding': 'gzip' } });
      expect(res2).contains('Compressed');
    });
  });

  it('errors if the fallback file is not found', { timeout: 3000 }, async ({ getTyped }) => {
    const router = new Router();
    router.use(
      await fileServer(getTyped(TEST_DIR), {
        fallback: { filePath: 'nope.txt' },
      }),
    );

    return withServer(router, async (url, { expectError }) => {
      const res1 = await fetch(url + '/missing');
      expect(res1.status).equals(500);
      expect(await res1.text()).equals('');
      expectError(
        'handling request /missing: HTTPError(500 Internal Server Error): failed to find fallback file',
      );
    });
  });

  it('allows otherwise hidden paths as a fallback', { timeout: 3000 }, async ({ getTyped }) => {
    const router = new Router();
    router.use(await fileServer(getTyped(TEST_DIR), { fallback: { filePath: 'index.htm' } }));
    router.use(requestHandler((_, res) => res.end('nope')));

    return withServer(router, async (url) => {
      const res1 = await fetch(url + '/missing');
      expect(res1.status).equals(200);
      expect(await res1.text()).equals('Root Index');
    });
  });
});
