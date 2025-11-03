import { join, sep } from 'node:path';
import {
  makeFileStructure,
  makeTestTempDir,
  type FilesDefinition,
} from '../../test-helpers/makeFileStructure.mts';
import { readHTTPQualityValues } from '../request/headers.mts';
import { FileFinder, type FileFinderCore, type FileFinderOptions } from './FileFinder.mts';
import type { TypedParameters } from 'lean-test';

describe(
  'FileFinder',
  ({ isPrecomputed }: any) => {
    it('resolves files within a directory', async (props) => {
      const fileFinder = await initialise(props, {
        'one.txt': 'Content',
        'two.txt': 'Other',
        sub: { 'three.txt': 'Nested Content' },
      });

      const one = await fileFinder.find(['one.txt']);
      expect(one).isTruthy();
      try {
        expect(one!.mime).isUndefined();
        expect(one!.language).isUndefined();
        expect(one!.encoding).isUndefined();
        expect(one!.canonicalPath).endsWith(sep + 'one.txt');
        expect(one!.negotiatedPath).endsWith(sep + 'one.txt');
        expect(one!.stats.size).equals(7);
      } finally {
        one?.handle.close();
      }

      const three = await fileFinder.find(['sub', 'three.txt']);
      expect(three).isTruthy();
      try {
        expect(three!.canonicalPath).endsWith(sep + join('sub', 'three.txt'));
        expect(three!.negotiatedPath).endsWith(sep + join('sub', 'three.txt'));
        expect(three!.stats.size).equals(14);
      } finally {
        three?.handle.close();
      }

      expect(await fileExists(fileFinder, ['three.txt'])).isFalse();
    });

    it('serves index files if a directory is requested', async (props) => {
      const fileFinder = await initialise(props, {
        sub1: {
          'index.htm': 'Index Content',
          'foo.htm': 'Other Content',
        },
        sub2: { 'nope.htm': 'Nested Content' },
      });

      const index = await fileFinder.find(['sub1']);
      expect(index).isTruthy();
      try {
        expect(index!.canonicalPath).endsWith(sep + join('sub1', 'index.htm'));
        expect(index!.negotiatedPath).endsWith(sep + join('sub1', 'index.htm'));
        expect(index!.stats.size).equals(13);
      } finally {
        index?.handle.close();
      }

      // direct access to file is blocked
      expect(await fileExists(fileFinder, ['sub1', 'index.htm'])).isFalse();

      // dir without index serves nothing
      expect(await fileExists(fileFinder, ['sub2'])).isFalse();
    });

    it('does not allow access to files outside the directory', async (props) => {
      const dir = props.getTyped(TEST_DIR);
      const fileFinder = await initialise(
        props,
        {
          'one.txt': 'Blocked Content',
          sub: { 'ok.txt': 'Permitted Content' },
        },
        {},
        'sub',
      );

      expect(await fileExists(fileFinder, ['one.txt'])).isFalse();
      expect(await fileExists(fileFinder, ['..', 'one.txt'])).isFalse();
      expect(await fileExists(fileFinder, ['../one.txt'])).isFalse();
      expect(await fileExists(fileFinder, [...dir.split(sep), 'one.txt'])).isFalse();

      const ok = await fileFinder.find(['ok.txt']);
      expect(ok).isTruthy();
      try {
        expect(ok!.stats.size).equals(17);
      } finally {
        ok?.handle.close();
      }
    });

    it('does not allow access to special files by default', async (props) => {
      const fileFinder = await initialise(props, {
        '.dot': 'Blocked Content',
        '~tilde': 'Blocked Content',
        'tilde~': 'Blocked Content',
        '.dir': { 'no.txt': 'Blocked Content' },
        '.well-known': { 'yes.txt': 'Allowed Content' },
      });

      expect(await fileExists(fileFinder, ['.dot'])).isFalse();
      expect(await fileExists(fileFinder, ['~tilde'])).isFalse();
      expect(await fileExists(fileFinder, ['tilde~'])).isFalse();
      expect(await fileExists(fileFinder, ['.dir', 'no.txt'])).isFalse();

      const ok = await fileFinder.find(['.well-known', 'yes.txt']);
      expect(ok).isTruthy();
      try {
        expect(ok!.stats.size).equals(15);
      } finally {
        ok?.handle.close();
      }
    });

    it('is case sensitive by default', async (props) => {
      const fileFinder = await initialise(props, {
        'one.txt': 'Content',
        'TWO.txt': 'Other',
        Sub: { 'three.txt': 'Nested Content' },
      });

      expect(await fileExists(fileFinder, ['one.txt'])).isTrue();
      expect(await fileExists(fileFinder, ['ONE.txt'])).isFalse();
      expect(await fileExists(fileFinder, ['two.txt'])).isFalse();
      expect(await fileExists(fileFinder, ['sub', 'three.txt'])).isFalse();
      expect(await fileExists(fileFinder, ['Sub', 'three.txt'])).isTrue();
    });

    it('forces all paths lowercase if configured', async (props) => {
      const fileFinder = await initialise(
        props,
        {
          'one.txt': 'Content',
          sub: { 'two.txt': 'Nested Content' },
        },
        { caseSensitive: 'force-lowercase' },
      );

      expect(await fileExists(fileFinder, ['one.txt'])).isTrue();
      expect(await fileExists(fileFinder, ['ONE.txt'])).isTrue();
      expect(await fileExists(fileFinder, ['sub', 'two.txt'])).isTrue();
      expect(await fileExists(fileFinder, ['Sub', 'two.TXT'])).isTrue();
    });

    it('returns specific file variants if negotiated', async (props) => {
      const fileFinder = await initialise(
        props,
        {
          'one.txt': 'Content',
          'one.txt.gz': 'Compressed Content',
          'two.txt': 'Content',
        },
        { negotiation: [{ type: 'encoding', options: [{ match: 'gzip', file: '{file}.gz' }] }] },
      );

      const withGzip = await fileFinder.find(['one.txt'], {
        encoding: readHTTPQualityValues('gzip;q=0.5'),
      });
      expect(withGzip).isTruthy();
      try {
        expect(withGzip!.mime).isUndefined();
        expect(withGzip!.language).isUndefined();
        expect(withGzip!.encoding).equals('gzip');
        expect(withGzip!.canonicalPath).endsWith(sep + 'one.txt');
        expect(withGzip!.negotiatedPath).endsWith(sep + 'one.txt.gz');
        expect(withGzip!.stats.size).equals(18);
      } finally {
        withGzip?.handle.close();
      }

      const withoutGzip = await fileFinder.find(['one.txt'], {});
      expect(withoutGzip).isTruthy();
      try {
        expect(withoutGzip!.mime).isUndefined();
        expect(withoutGzip!.language).isUndefined();
        expect(withoutGzip!.encoding).isUndefined();
        expect(withoutGzip!.canonicalPath).endsWith(sep + 'one.txt');
        expect(withoutGzip!.negotiatedPath).endsWith(sep + 'one.txt');
        expect(withoutGzip!.stats.size).equals(7);
      } finally {
        withoutGzip?.handle.close();
      }

      const noGzip = await fileFinder.find(['two.txt'], {
        encoding: readHTTPQualityValues('gzip;q=0.5'),
      });
      expect(noGzip).isTruthy();
      try {
        expect(noGzip!.mime).isUndefined();
        expect(noGzip!.language).isUndefined();
        expect(noGzip!.encoding).isUndefined();
        expect(noGzip!.canonicalPath).endsWith(sep + 'two.txt');
        expect(noGzip!.negotiatedPath).endsWith(sep + 'two.txt');
        expect(noGzip!.stats.size).equals(7);
      } finally {
        noGzip?.handle.close();
      }
    });

    const TEST_DIR = makeTestTempDir('ff-');

    async function initialise(
      { getTyped }: TypedParameters,
      structure: FilesDefinition,
      options: FileFinderOptions = {},
      relativePath = '',
    ) {
      const dir = getTyped(TEST_DIR);
      await makeFileStructure(dir, structure);
      const fileFinder = await FileFinder.build(join(dir, relativePath), options);
      if (isPrecomputed) {
        return fileFinder.precompute();
      } else {
        return fileFinder;
      }
    }
  },
  {
    parameters: [
      { name: 'Dynamic', isPrecomputed: false },
      { name: 'Precomputed', isPrecomputed: true },
    ],
  },
);

async function fileExists(fileFinder: FileFinderCore, path: string[]) {
  const file = await fileFinder.find(path);
  const exists = Boolean(file);
  file?.handle.close();
  return exists;
}
