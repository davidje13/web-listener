import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { text } from 'node:stream/consumers';
import { unpack } from '../../test-helpers/unpack.mts';
import { AssetOpener } from './AssetOpener.mts';
import 'lean-test';

const selfDir = dirname(fileURLToPath(import.meta.url));
const testZipDir = join(selfDir, 'test-zips');

describe('AssetOpener', () => {
  describe('open', () => {
    it('returns a file handle for regular files', { timeout: 3000 }, async () => {
      const opener = new AssetOpener();
      const fd = await opener.open(fileURLToPath(import.meta.url));
      try {
        const stat = await fd.stat();
        expect(stat.isFile()).isTrue();
        expect(stat.size).isGreaterThan(100);
        expect(await text(fd.createReadStream())).contains('self-referencing string');
      } finally {
        await fd.close();
      }
    });

    it('returns a file handle for zip files', { timeout: 3000 }, async () => {
      const opener = new AssetOpener();
      const fd = await opener.open(join(testZipDir, 'test.zip'));
      try {
        const stat = await fd.stat();
        expect(stat.isFile()).isTrue();
        expect(stat.size).equals(872);
      } finally {
        await fd.close();
      }
    });

    it('returns a read-only file handle for files in zips', { timeout: 3000 }, async () => {
      const opener = new AssetOpener();
      const fd = await opener.open(join(testZipDir, 'test.zip', 'test1.txt'));
      try {
        const stat = await fd.stat();
        expect(stat.isFile()).isTrue();
        expect(stat.size).equals(107);
        expect(await text(fd.createReadStream())).startsWith('test file content with repetition');
      } finally {
        await fd.close();
      }
    });

    it('fails if the path is not found', { timeout: 3000 }, async () => {
      const opener = new AssetOpener();
      await expect(opener.open(join(testZipDir, 'test.zip', 'nope.txt'))).throws(
        '/nope.txt not found in ',
      );
    });
  });

  describe('findZipNode', () => {
    it('returns a zip node for a path within a zip', { timeout: 3000 }, async () => {
      const opener = new AssetOpener();
      const node = await opener.findZipNode(join(testZipDir, 'test.zip', 'test1.txt'));
      expect(node).isTruthy();
      expect(node!.isDirectory).isFalse();
      expect(node!.filesystemPath).endsWith('test.zip/test1.txt');
    });

    it('returns a zip node for the root of a zip', { timeout: 3000 }, async () => {
      const opener = new AssetOpener();
      const node = await opener.findZipNode(join(testZipDir, 'test.zip'));
      expect(node).isTruthy();
      expect(node!.isDirectory).isTrue();
      expect(node!.filesystemPath).endsWith('test.zip');
    });

    it('returns undefined if the path in the zip is not found', { timeout: 3000 }, async () => {
      const opener = new AssetOpener();
      await expect(opener.findZipNode(join(testZipDir, 'test.zip', 'nope.txt'))).resolves(
        isUndefined(),
      );
    });

    it('returns undefined if the zip is not found', { timeout: 3000 }, async () => {
      const opener = new AssetOpener();
      await expect(opener.findZipNode(join(testZipDir, 'test-nope.zip', 'test.txt'))).resolves(
        isUndefined(),
      );
    });
  });

  describe('findCachedZipNodeSync', () => {
    it('synchronously returns a zip node for a path within a zip', { timeout: 3000 }, async () => {
      const opener = new AssetOpener();
      await opener.preloadMetadata(join(testZipDir, 'test.zip', 'test1.txt'));
      const node = opener.findCachedZipNodeSync(join(testZipDir, 'test.zip', 'test1.txt'));
      expect(node).isTruthy();
      expect(node!.isDirectory).isFalse();
      expect(node!.filesystemPath).endsWith('test.zip/test1.txt');
    });

    it('returns undefined if a cached value is not available', { timeout: 3000 }, () => {
      const opener = new AssetOpener();
      expect(opener.findCachedZipNodeSync(join(testZipDir, 'test.zip', 'test1.txt'))).isUndefined();
    });

    it('returns undefined if the cache has been cleared', { timeout: 3000 }, async () => {
      const opener = new AssetOpener();
      await opener.preloadMetadata(join(testZipDir, 'test.zip', 'test1.txt'));
      opener.clearMetadataCache();
      expect(opener.findCachedZipNodeSync(join(testZipDir, 'test.zip', 'test1.txt'))).isUndefined();
    });
  });

  // test zip archives are compressed to save space in the repository - expand them for testing
  beforeAll(() => unpack(join(selfDir, 'test-zips.zip'), testZipDir));
});
