import { join, sep } from 'node:path';
import {
  makeFileStructure,
  makeTestTempDir,
  type FilesDefinition,
} from '../../test-helpers/makeFileStructure.mts';
import { Negotiator } from '../request/Negotiator.mts';
import { FileFinder, type FileFinderCore, type FileFinderOptions } from './FileFinder.mts';
import type { TypedParameters } from 'lean-test';

function fileFinderTestSuite(isPrecomputed: boolean) {
  it('resolves files within a directory', async (props) => {
    const fileFinder = await initialise(props, {
      'one.txt': 'Content',
      'two.txt': 'Other',
      sub: { 'three.txt': 'Nested Content' },
    });

    const one = await fileFinder.find(['one.txt']);
    expect(one).isTruthy();
    try {
      expect(one!.headers['content-type']).isUndefined();
      expect(one!.headers['content-language']).isUndefined();
      expect(one!.headers['content-language']).isUndefined();
      expect(one!.headers['vary']).isUndefined();
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

  it('serves the root index file if the root is requested', async (props) => {
    const fileFinder = await initialise(props, {
      'index.htm': 'Index Content',
    });

    const index = await fileFinder.find([]);
    expect(index).isTruthy();
    try {
      expect(index!.canonicalPath).endsWith(sep + join('index.htm'));
      expect(index!.negotiatedPath).endsWith(sep + join('index.htm'));
      expect(index!.stats.size).equals(13);
    } finally {
      index?.handle.close();
    }

    // direct access to file is blocked
    expect(await fileExists(fileFinder, ['index.htm'])).isFalse();
  });

  it('uses configured index files', async (props) => {
    const fileFinder = await initialise(
      props,
      { sub: { 'index.htm': 'Index Content', 'custom.thing': 'Custom Content' } },
      { indexFiles: ['custom.thing'] },
    );

    const index = await fileFinder.find(['sub']);
    expect(index).isTruthy();
    try {
      expect(index!.canonicalPath).endsWith(sep + join('sub', 'custom.thing'));
      expect(index!.negotiatedPath).endsWith(sep + join('sub', 'custom.thing'));
      expect(index!.stats.size).equals(14);
    } finally {
      index?.handle.close();
    }

    // direct access to file is blocked
    expect(await fileExists(fileFinder, ['sub', 'custom.thing'])).isFalse();
  });

  it('prioritises index files by their configured order', async (props) => {
    const fileFinder = await initialise(
      props,
      { a: 'nope', m: 'yep', z: 'nope' },
      { indexFiles: ['m', 'a', 'z'] },
    );

    const index = await fileFinder.find([]);
    expect(index).isTruthy();
    try {
      expect(index!.canonicalPath).endsWith(sep + 'm');
      expect(index!.negotiatedPath).endsWith(sep + 'm');
      expect(index!.stats.size).equals(3);
    } finally {
      index?.handle.close();
    }
  });

  it('uses configured suffixes if the requested file does not exist', async (props) => {
    const fileFinder = await initialise(
      props,
      {
        'file.foo': 'Foo',
        'other.bar': 'Bar',
        raw: 'Direct',
        'raw.foo': 'Non-direct',
        'dir.foo': 'Non-dir',
        dir: {},
      },
      { implicitSuffixes: ['.foo', '.bar'] },
    );

    const f1 = await fileFinder.find(['file']);
    expect(f1).isTruthy();
    try {
      expect(f1!.canonicalPath).endsWith(sep + 'file.foo');
      expect(f1!.negotiatedPath).endsWith(sep + 'file.foo');
      expect(f1!.stats.size).equals(3);
    } finally {
      f1?.handle.close();
    }

    const f2 = await fileFinder.find(['other']);
    expect(f2).isTruthy();
    try {
      expect(f2!.canonicalPath).endsWith(sep + 'other.bar');
      expect(f2!.negotiatedPath).endsWith(sep + 'other.bar');
      expect(f2!.stats.size).equals(3);
    } finally {
      f2?.handle.close();
    }

    const f3 = await fileFinder.find(['raw']);
    expect(f3).isTruthy();
    try {
      expect(f3!.canonicalPath).endsWith(sep + 'raw');
      expect(f3!.negotiatedPath).endsWith(sep + 'raw');
      expect(f3!.stats.size).equals(6);
    } finally {
      f3?.handle.close();
    }

    expect(await fileExists(fileFinder, ['dir'])).isFalse();

    // direct access to file is blocked
    expect(await fileExists(fileFinder, ['sub', 'custom.thing'])).isFalse();
  });

  it('prioritises suffixes by their configured order', async (props) => {
    const fileFinder = await initialise(
      props,
      { aa: 'nope', am: 'yep', az: 'nope' },
      { implicitSuffixes: ['m', 'a', 'z'] },
    );

    const index = await fileFinder.find(['a']);
    expect(index).isTruthy();
    try {
      expect(index!.canonicalPath).endsWith(sep + 'am');
      expect(index!.negotiatedPath).endsWith(sep + 'am');
      expect(index!.stats.size).equals(3);
    } finally {
      index?.handle.close();
    }
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
      {
        negotiator: new Negotiator([
          { feature: 'encoding', options: [{ value: 'gzip', file: '{file}.gz' }] },
        ]),
      },
    );

    const withGzip = await fileFinder.find(['one.txt'], { 'accept-encoding': 'gzip;q=0.5' });
    expect(withGzip).isTruthy();
    try {
      expect(withGzip!.headers['content-type']).isUndefined();
      expect(withGzip!.headers['content-language']).isUndefined();
      expect(withGzip!.headers['content-encoding']).equals('gzip');
      expect(withGzip!.headers['vary']).equals('accept-encoding');
      expect(withGzip!.canonicalPath).endsWith(sep + 'one.txt');
      expect(withGzip!.negotiatedPath).endsWith(sep + 'one.txt.gz');
      expect(withGzip!.stats.size).equals(18);
    } finally {
      withGzip?.handle.close();
    }

    const withoutGzip = await fileFinder.find(['one.txt'], {});
    expect(withoutGzip).isTruthy();
    try {
      expect(withoutGzip!.headers['content-type']).isUndefined();
      expect(withoutGzip!.headers['content-language']).isUndefined();
      expect(withoutGzip!.headers['content-encoding']).isUndefined();
      expect(withoutGzip!.headers['vary']).equals('accept-encoding');
      expect(withoutGzip!.canonicalPath).endsWith(sep + 'one.txt');
      expect(withoutGzip!.negotiatedPath).endsWith(sep + 'one.txt');
      expect(withoutGzip!.stats.size).equals(7);
    } finally {
      withoutGzip?.handle.close();
    }

    const noGzip = await fileFinder.find(['two.txt'], { 'accept-encoding': 'gzip;q=0.5' });
    expect(noGzip).isTruthy();
    try {
      expect(noGzip!.headers['content-type']).isUndefined();
      expect(noGzip!.headers['content-language']).isUndefined();
      expect(noGzip!.headers['content-encoding']).isUndefined();
      expect(noGzip!.headers['vary']).equals('accept-encoding');
      expect(noGzip!.canonicalPath).endsWith(sep + 'two.txt');
      expect(noGzip!.negotiatedPath).endsWith(sep + 'two.txt');
      expect(noGzip!.stats.size).equals(7);
    } finally {
      noGzip?.handle.close();
    }
  });

  describe('debugAllPaths', () => {
    it('returns a set of all recognised paths', async (props) => {
      const fileFinder = await initialise(props, {
        'foo.txt': 'Hello',
        sub1: {
          'index.htm': 'Index Content',
          'foo.htm': 'Other Content',
        },
        sub2: { 'nope.htm': 'Nested Content' },
      });

      const paths = await fileFinder.debugAllPaths();
      expect(paths).equals(new Set(['foo.txt', 'sub1', 'sub1/foo.htm', 'sub2/nope.htm']));
    });
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
}

describe('FileFinder (Dynamic)', () => fileFinderTestSuite(false));
describe('FileFinder (Precomputed)', () => fileFinderTestSuite(true));

async function fileExists(fileFinder: FileFinderCore, path: string[]) {
  const file = await fileFinder.find(path);
  const exists = Boolean(file);
  file?.handle.close();
  return exists;
}
