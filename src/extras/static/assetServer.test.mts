import { platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTestTempDir } from '../../test-helpers/makeFileStructure.mts';
import { withServer } from '../../test-helpers/withServer.mts';
import { makeRequestOnSocket, openRawSocket, rawRequest } from '../../test-helpers/rawRequest.mts';
import { requestHandler } from '../../core/handler.mts';
import { Router } from '../../core/Router.mts';
import { negotiateEncoding, Negotiator } from '../request/Negotiator.mts';
import { dynamicFileFinder } from '../filesystem/dynamicFileFinder.mts';
import { staticFileFinder } from '../filesystem/staticFileFinder.mts';
import { zipFileFinder } from '../filesystem/zipFileFinder.mts';
import { readZip } from '../filesystem/readZip.mts';
import { assetServer } from './assetServer.mts';
import 'lean-test';

describe('assetServer', () => {
  const TEST_DIR = makeTestTempDir('as-', {
    'file.txt': 'Content',
    'file.txt.gz': 'Compressed',
    'index.htm': 'Root Index',
    'ext.other.js': 'JS',
    'special%char.txt': 'Special',
    sub: {
      'index.html': 'Sub Index',
    },
    none: {},
  });

  it('serves files from a FileFinder', { timeout: 3000 }, async ({ getTyped }) => {
    const handler = assetServer(await dynamicFileFinder(getTyped(TEST_DIR)));

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

  it('adds content-type based on the file extension', { timeout: 3000 }, async ({ getTyped }) => {
    const handler = assetServer(await dynamicFileFinder(getTyped(TEST_DIR)));

    return withServer(handler, async (url) => {
      const resText = await fetch(url + '/file.txt');
      expect(resText.status).equals(200);
      expect(resText.headers.get('content-type')).equals('text/plain; charset=utf-8');

      const resJS = await fetch(url + '/ext.other.js');
      expect(resJS.status).equals(200);
      expect(resJS.headers.get('content-type')).equals('text/javascript; charset=utf-8');

      const resHtml = await fetch(url + '/sub');
      expect(resHtml.status).equals(200);
      expect(resHtml.headers.get('content-type')).equals('text/html; charset=utf-8');
    });
  });

  it(
    'serves index pages when directories are requested',
    { timeout: 3000 },
    async ({ getTyped }) => {
      const handler = assetServer(await dynamicFileFinder(getTyped(TEST_DIR)));

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

  it(
    'serves files with special characters in dynamic mode',
    { timeout: 3000 },
    async ({ getTyped }) => {
      const handler = assetServer(await dynamicFileFinder(getTyped(TEST_DIR)));

      return withServer(handler, async (url) => {
        const res = await fetch(url + '/special%25char.txt');
        expect(res.status).equals(200);
        expect(await res.text()).equals('Special');
      });
    },
  );

  it(
    'serves files with special characters in static paths mode',
    { timeout: 3000 },
    async ({ getTyped }) => {
      const handler = assetServer(await staticFileFinder(getTyped(TEST_DIR)));

      return withServer(handler, async (url) => {
        const res = await fetch(url + '/special%25char.txt');
        expect(res.status).equals(200);
        expect(await res.text()).equals('Special');
      });
    },
  );

  it('rejects requests with %2f in dynamic mode', { timeout: 3000 }, async ({ getTyped }) => {
    const handler = assetServer(await dynamicFileFinder(getTyped(TEST_DIR)));

    return withServer(handler, async (url, { expectError }) => {
      const res = await fetch(url + '/sub%2f');
      expect(res.status).equals(400);
      if (platform() === 'win32') {
        expect(await res.text()).equals('');
        expectError('handling request /sub%2f: HTTPError(404 Not Found)');
      } else {
        expect(await res.text()).equals('invalid path');
        expectError('handling request /sub%2f: HTTPError(400 Bad Request): invalid path');
      }
    });
  });

  it('rejects requests with %2f in static paths mode', { timeout: 3000 }, async ({ getTyped }) => {
    const handler = assetServer(await staticFileFinder(getTyped(TEST_DIR)));

    return withServer(handler, async (url, { expectError }) => {
      const res = await fetch(url + '/sub%2f');
      expect(res.status).equals(404);
      expect(await res.text()).equals('');
      expectError('handling request /sub%2f: HTTPError(404 Not Found)');
    });
  });

  it('supports content negotiation', { timeout: 3000 }, async ({ getTyped }) => {
    const handler = assetServer(
      await dynamicFileFinder(getTyped(TEST_DIR), {
        negotiator: new Negotiator([negotiateEncoding(['gzip'])]),
      }),
    );

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
    router.use(assetServer(await dynamicFileFinder(getTyped(TEST_DIR))));
    router.use(requestHandler((_, res) => res.end('nope')));

    return withServer(router, async (url) => {
      const res = await fetch(url + '/missing');
      expect(await res.text()).equals('nope');
    });
  });

  it('reports verbose error information if configured', { timeout: 3000 }, async ({ getTyped }) => {
    const router = new Router();
    router.use(assetServer(await dynamicFileFinder(getTyped(TEST_DIR)), { verbose: true }));
    router.use(requestHandler((_, res) => res.end('nope')));

    return withServer(router, async (url, { expectError }) => {
      const res = await fetch(url + '/missing');
      expect(await res.text()).equals('nope');
      expectError(/serving static content \/missing: Error: file ".*" does not exist/);
    });
  });

  it('ignores non-GET/HEAD requests', { timeout: 3000 }, async ({ getTyped }) => {
    const router = new Router();
    router.use(assetServer(await dynamicFileFinder(getTyped(TEST_DIR))));
    router.use(requestHandler((req, res) => res.end(`fallback ${req.method}`)));

    return withServer(router, async (url) => {
      const res = await fetch(url + '/file.txt', { method: 'POST' });
      expect(await res.text()).equals('fallback POST');
    });
  });

  it('falls back to a specific file if configured', { timeout: 3000 }, async ({ getTyped }) => {
    const router = new Router();
    router.use(
      assetServer(
        await dynamicFileFinder(getTyped(TEST_DIR), {
          negotiator: new Negotiator([negotiateEncoding(['gzip'])]),
        }),
        { fallback: { filePath: 'file.txt', statusCode: 255 } },
      ),
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
      assetServer(await dynamicFileFinder(getTyped(TEST_DIR)), {
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
    router.use(
      assetServer(await dynamicFileFinder(getTyped(TEST_DIR)), {
        fallback: { filePath: 'index.htm' },
      }),
    );
    router.use(requestHandler((_, res) => res.end('nope')));

    return withServer(router, async (url) => {
      const res1 = await fetch(url + '/missing');
      expect(res1.status).equals(200);
      expect(await res1.text()).equals('Root Index');
    });
  });
});

describe('assetServer with large content', () => {
  const size = 70000; // must be larger than the 65k high water mark
  const TEST_DIR = makeTestTempDir('as-', { 'large.txt': 'a'.repeat(size) });

  it(
    'emits no error if the client disconnects before the file is sent',
    { timeout: 3000 },
    async ({ getTyped }) => {
      const handler = assetServer(await dynamicFileFinder(getTyped(TEST_DIR)));

      return withServer(handler, async (url) => {
        const urlObj = new URL(url);
        const socket = await openRawSocket(urlObj);
        makeRequestOnSocket(socket, urlObj.host, '/large.txt', {});
        let seen = Number.POSITIVE_INFINITY;
        socket.once('data', (data) => {
          seen = data.length;
          socket.destroy(); // close connection while data is being sent back
        });

        // wait a moment for send to finish and potentially error
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(seen).isLessThan(size);
      });
    },
  );
});

describe('assetServer with zipFileFinder', () => {
  const testZip = join(dirname(fileURLToPath(import.meta.url)), 'test-assets.zip');

  it('serves files directly from the zip', { timeout: 3000 }, async () => {
    const handler = assetServer(zipFileFinder(await readZip(testZip)));

    return withServer(handler, async (url) => {
      const res = await fetch(url + '/file.txt');
      expect(res.status).equals(200);
      expect(res.headers.get('content-type')).equals('text/plain; charset=utf-8');
      expect(res.headers.get('etag')!).startsWith('W/\"');
      expect(res.headers.get('last-modified')).equals('Wed, 01 Jul 2026 10:20:46 GMT');
      expect(await res.text()).equals('Zipped Content CompressedCompressedCompressed');
    });
  });

  it('serves gzip encoded files directly from the zip', { timeout: 3000 }, async () => {
    const handler = assetServer(
      zipFileFinder(await readZip(testZip), {
        negotiator: new Negotiator([negotiateEncoding(['zstd', 'gzip'])]),
      }),
    );

    return withServer(handler, async (url) => {
      const res = await fetch(url + '/file.txt', { headers: { 'accept-encoding': 'gzip' } });
      expect(res.status).equals(200);
      expect(res.headers.get('content-type')).equals('text/plain; charset=utf-8');
      expect(res.headers.get('content-encoding')).equals('gzip');
      expect(res.headers.get('etag')!).startsWith('W/\"');
      expect(res.headers.get('last-modified')).equals('Wed, 01 Jul 2026 10:20:46 GMT');
      expect(await res.text()).equals('Zipped Content CompressedCompressedCompressed');
    });
  });

  it('serves brotli encoded files from the zip', { timeout: 3000 }, async () => {
    const handler = assetServer(
      zipFileFinder(await readZip(testZip), {
        negotiator: new Negotiator([negotiateEncoding(['br'])]),
      }),
    );

    return withServer(handler, async (url) => {
      const res = await rawRequest(url + '/file.txt', { headers: { 'accept-encoding': 'br' } });
      expect(res).contains('Brotli Content');
      expect(res).contains('content-encoding: br');
      expect(res).contains('vary: accept-encoding');
    });
  });
});
