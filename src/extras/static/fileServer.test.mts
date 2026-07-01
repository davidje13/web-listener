import { makeTestTempDir } from '../../test-helpers/makeFileStructure.mts';
import { withServer } from '../../test-helpers/withServer.mts';
import { fileServer } from './fileServer.mts';
import 'lean-test';

describe('fileServer', () => {
  const TEST_DIR = makeTestTempDir('fs-', { 'file.txt': 'Content' });

  it('wraps assetServer(dynamicFileFinder) by default', { timeout: 3000 }, async ({ getTyped }) => {
    const handler = await fileServer(getTyped(TEST_DIR));

    return withServer(handler, async (url) => {
      const res = await fetch(url + '/file.txt');
      expect(res.status).equals(200);
      expect(res.headers.get('content-type')).equals('text/plain; charset=utf-8');
      expect(res.headers.get('etag')!).startsWith('W/\"');
      expect(res.headers.get('last-modified')).not(isNull());
      expect(await res.text()).equals('Content');
    });
  });

  it(
    'wraps assetServer(staticFileFinder) if mode is static-paths',
    { timeout: 3000 },
    async ({ getTyped }) => {
      const handler = await fileServer(getTyped(TEST_DIR), { mode: 'static-paths' });

      return withServer(handler, async (url) => {
        const res = await fetch(url + '/file.txt');
        expect(res.status).equals(200);
        expect(res.headers.get('content-type')).equals('text/plain; charset=utf-8');
        expect(res.headers.get('etag')!).startsWith('W/\"');
        expect(res.headers.get('last-modified')).not(isNull());
        expect(await res.text()).equals('Content');
      });
    },
  );
});
