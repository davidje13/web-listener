import { join } from 'node:path';
import { makeFileStructure, makeTestTempDir } from '../../test-helpers/makeFileStructure.mts';
import { fileFinderTestSuite } from './FileFinder.interface-spec.mts';
import { dynamicFileFinder } from './dynamicFileFinder.mts';
import 'lean-test';

describe('dynamicFileFinder', () => {
  const TEST_DIR = makeTestTempDir('dff-');

  fileFinderTestSuite(
    async (ctx, structure, options = {}, relativePath = []) => {
      const dir = ctx.getTyped(TEST_DIR);
      await makeFileStructure(dir, structure);
      return dynamicFileFinder(join(dir, ...relativePath), options);
    },
    (ctx) => ctx.getTyped(TEST_DIR),
  );
});
