import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTestTempDir } from '../../test-helpers/makeFileStructure.mts';
import { anyFileFinder } from './anyFileFinder.mts';
import 'lean-test';

describe('anyFileFinder', () => {
  describe('given a directory', () => {
    const TEST_DIR = makeTestTempDir('aff-', { 'file.txt': 'Content' });

    it('loads directories dynamically', async ({ getTyped }) => {
      const fileFinder = await anyFileFinder(getTyped(TEST_DIR), {});
      expect(fileFinder.isStaticListing).isFalse();
      const file = await fileFinder.find(['file.txt']);
      await file?.handle.close();
      expect(file?.stats.size).equals(7);
    });

    it('loads directories statically', async ({ getTyped }) => {
      const fileFinder = await anyFileFinder(getTyped(TEST_DIR), { mode: 'static-paths' });
      expect(fileFinder.isStaticListing).isTrue();
      const file = await fileFinder.find(['file.txt']);
      await file?.handle.close();
      expect(file?.stats.size).equals(7);
    });
  });

  it('loads zip contents', async () => {
    const testZip = join(dirname(fileURLToPath(import.meta.url)), 'test-assets.zip');

    const fileFinder = await anyFileFinder(testZip, {});
    expect(fileFinder.isStaticListing).isTrue();
    const file1 = await fileFinder.find(['file.txt']);
    await file1?.handle.close();
    expect(file1?.stats.size).equals(7);

    const file2 = await fileFinder.find(['sub', 'subfile.txt']);
    await file2?.handle.close();
    expect(file2?.stats.size).equals(14);
  });

  it('loads zip contents with trailing slash', async () => {
    const testZip = join(dirname(fileURLToPath(import.meta.url)), 'test-assets.zip') + sep;

    const fileFinder = await anyFileFinder(testZip, {});
    expect(fileFinder.isStaticListing).isTrue();
    const file1 = await fileFinder.find(['file.txt']);
    await file1?.handle.close();
    expect(file1?.stats.size).equals(7);

    const file2 = await fileFinder.find(['sub', 'subfile.txt']);
    await file2?.handle.close();
    expect(file2?.stats.size).equals(14);
  });

  it('loads nested zip contents', async () => {
    const testZip = join(dirname(fileURLToPath(import.meta.url)), 'test-assets.zip', 'sub');

    const fileFinder = await anyFileFinder(testZip, {});
    expect(fileFinder.isStaticListing).isTrue();
    const file = await fileFinder.find(['subfile.txt']);
    await file?.handle.close();
    expect(file?.stats.size).equals(14);

    expect(await fileFinder.find(['file.txt'])).isNull();
  });

  it('throws if given a path which does not exist', async () => {
    await expect(() => anyFileFinder('/does/not/exist', {})).throws(
      'content to serve not found at /does/not/exist',
    );
  });
});
