import { join } from 'node:path';
import {
  makeFileStructure,
  makeTestTempDir,
  type FilesDefinition,
} from '../../test-helpers/makeFileStructure.mts';
import type { FileFinderOptions } from './FileFinder.mts';
import { fileFinderTestSuite } from './FileFinder.interface-spec.mts';
import { staticFileFinder } from './staticFileFinder.mts';
import type { TypedParameters } from 'lean-test';
import 'lean-test';

describe('staticFileFinder', () => {
  const TEST_DIR = makeTestTempDir('sff-');

  const initialise = async (
    ctx: TypedParameters,
    structure: FilesDefinition,
    options: FileFinderOptions = {},
    relativePath: string[] = [],
  ) => {
    const dir = ctx.getTyped(TEST_DIR);
    await makeFileStructure(dir, structure);
    return staticFileFinder(join(dir, ...relativePath), options);
  };

  fileFinderTestSuite(initialise, (ctx) => ctx.getTyped(TEST_DIR));

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
