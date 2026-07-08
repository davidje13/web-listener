import { join, sep } from 'node:path';
import {
  makeTestTempDir,
  writeTestZip,
  type FilesDefinition,
} from '../../test-helpers/makeFileStructure.mts';
import { Negotiator } from '../request/Negotiator.mts';
import type { FileFinderOptions } from './FileFinder.mts';
import { fileFinderTestSuite } from './FileFinder.interface-spec.mts';
import { zipFileFinder } from './zipFileFinder.mts';
import { readZip, type ZipDirectory } from './readZip.mts';
import type { TypedParameters } from 'lean-test';
import 'lean-test';

describe('zipFileFinder', () => {
  const TEST_DIR = makeTestTempDir('zff-');

  const initialise = async (
    ctx: TypedParameters,
    structure: FilesDefinition,
    options: FileFinderOptions = {},
    relativePath: string[] = [],
  ) => {
    const zipPath = join(ctx.getTyped(TEST_DIR), 'all.zip');
    await writeTestZip(zipPath, structure);
    const root = await readZip(zipPath);
    return zipFileFinder(root.find(relativePath) as ZipDirectory, options);
  };

  fileFinderTestSuite(initialise, (ctx) => ctx.getTyped(TEST_DIR));

  it('makes non-standard deflated versions of files available for negotiation automatically', async (ctx) => {
    const fileFinder = await initialise(
      ctx,
      { 'long.txt': 'Long'.repeat(100), 'short.txt': 'Short' },
      {
        negotiator: new Negotiator([
          { feature: 'encoding', options: [{ value: 'deflate', file: '{file}.deflate-raw' }] },
        ]),
      },
    );

    const withDeflate = await fileFinder.find(['long.txt'], { 'accept-encoding': 'deflate;q=0.5' });
    expect(withDeflate).isTruthy();
    try {
      expect(withDeflate!.headers['content-type']).isUndefined();
      expect(withDeflate!.headers['content-language']).isUndefined();
      expect(withDeflate!.headers['content-encoding']).equals('deflate');
      expect(withDeflate!.headers['vary']).equals('accept-encoding');
      expect(withDeflate!.canonicalFilename).equals('long.txt');
      expect(withDeflate!.filesystemPath).endsWith(sep + 'long.txt.deflate-raw');
      expect(withDeflate!.stats.size).isLessThan(400);
    } finally {
      withDeflate?.handle.close();
    }

    const withoutDeflate = await fileFinder.find(['long.txt'], {});
    expect(withoutDeflate).isTruthy();
    try {
      expect(withoutDeflate!.headers['content-type']).isUndefined();
      expect(withoutDeflate!.headers['content-language']).isUndefined();
      expect(withoutDeflate!.headers['content-encoding']).isUndefined();
      expect(withoutDeflate!.headers['vary']).equals('accept-encoding');
      expect(withoutDeflate!.canonicalFilename).equals('long.txt');
      expect(withoutDeflate!.filesystemPath).endsWith(sep + 'long.txt');
      expect(withoutDeflate!.stats.size).equals(400);
    } finally {
      withoutDeflate?.handle.close();
    }

    const noDeflate = await fileFinder.find(['short.txt'], { 'accept-encoding': 'deflate;q=0.5' });
    expect(noDeflate).isTruthy();
    try {
      expect(noDeflate!.headers['content-type']).isUndefined();
      expect(noDeflate!.headers['content-language']).isUndefined();
      expect(noDeflate!.headers['content-encoding']).isUndefined();
      expect(noDeflate!.headers['vary']).equals('accept-encoding');
      expect(noDeflate!.canonicalFilename).equals('short.txt');
      expect(noDeflate!.filesystemPath).endsWith(sep + 'short.txt');
      expect(noDeflate!.stats.size).equals(5);
    } finally {
      noDeflate?.handle.close();
    }

    const directAccess = await fileFinder.find(['long.txt.deflate-raw']);
    try {
      expect(directAccess).isNull();
    } finally {
      directAccess?.handle.close();
    }
  });

  it('makes gzip versions of files available for negotiation automatically', async (ctx) => {
    const fileFinder = await initialise(
      ctx,
      { 'long.txt': 'Long'.repeat(100), 'short.txt': 'Short' },
      {
        negotiator: new Negotiator([
          { feature: 'encoding', options: [{ value: 'gzip', file: '{file}.gz' }] },
        ]),
      },
    );

    const withGzip = await fileFinder.find(['long.txt'], { 'accept-encoding': 'gzip;q=0.5' });
    expect(withGzip).isTruthy();
    try {
      expect(withGzip!.headers['content-type']).isUndefined();
      expect(withGzip!.headers['content-language']).isUndefined();
      expect(withGzip!.headers['content-encoding']).equals('gzip');
      expect(withGzip!.headers['vary']).equals('accept-encoding');
      expect(withGzip!.canonicalFilename).equals('long.txt');
      expect(withGzip!.filesystemPath).endsWith(sep + 'long.txt.gz');
      expect(withGzip!.stats.size).isLessThan(400);
    } finally {
      withGzip?.handle.close();
    }

    const withoutGzip = await fileFinder.find(['long.txt'], {});
    expect(withoutGzip).isTruthy();
    try {
      expect(withoutGzip!.headers['content-type']).isUndefined();
      expect(withoutGzip!.headers['content-language']).isUndefined();
      expect(withoutGzip!.headers['content-encoding']).isUndefined();
      expect(withoutGzip!.headers['vary']).equals('accept-encoding');
      expect(withoutGzip!.canonicalFilename).equals('long.txt');
      expect(withoutGzip!.filesystemPath).endsWith(sep + 'long.txt');
      expect(withoutGzip!.stats.size).equals(400);
    } finally {
      withoutGzip?.handle.close();
    }

    const noGzip = await fileFinder.find(['short.txt'], { 'accept-encoding': 'gzip;q=0.5' });
    expect(noGzip).isTruthy();
    try {
      expect(noGzip!.headers['content-type']).isUndefined();
      expect(noGzip!.headers['content-language']).isUndefined();
      expect(noGzip!.headers['content-encoding']).isUndefined();
      expect(noGzip!.headers['vary']).equals('accept-encoding');
      expect(noGzip!.canonicalFilename).equals('short.txt');
      expect(noGzip!.filesystemPath).endsWith(sep + 'short.txt');
      expect(noGzip!.stats.size).equals(5);
    } finally {
      noGzip?.handle.close();
    }

    const directAccess = await fileFinder.find(['long.txt.gz']);
    try {
      expect(directAccess).isNull();
    } finally {
      directAccess?.handle.close();
    }
  });

  describe('staticPaths', () => {
    it('returns a set of all recognised paths', async (ctx) => {
      const fileFinder = await initialise(ctx, {
        'foo.txt': 'Hello',
        sub1: {
          'index.htm': 'Index Content',
          'foo.htm': 'Other Content',
        },
        sub2: { 'nope.htm': 'Nested Content' },
      });

      const paths = fileFinder.staticPaths();
      expect(paths).equals(new Set(['foo.txt', 'sub1', 'sub1/foo.htm', 'sub2/nope.htm']));
    });
  });
});
