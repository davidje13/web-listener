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

  it('makes deflated versions of files available for negotiation automatically', async (ctx) => {
    const fileFinder = await initialise(
      ctx,
      { 'long.txt': 'Long'.repeat(100), 'short.txt': 'Short' },
      {
        negotiator: new Negotiator([
          { feature: 'encoding', options: [{ value: 'deflate', file: '{file}.deflate' }] },
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
      expect(withDeflate!.filesystemPath).endsWith(sep + 'long.txt.deflate');
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

    const directAccess = await fileFinder.find(['long.txt.deflate']);
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
