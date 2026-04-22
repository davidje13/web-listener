import { join } from 'node:path';
import { makeTestTempDir } from '../../test-helpers/makeFileStructure.mts';
import { getResolvedExportMap, readPackageGraph, type PackageJson } from './PackageInfo.mts';
import 'lean-test';

const VOID_VERSION = 'file:/dev/null';

describe.ignore('readPackageGraph', () => {
  // TODO: requires --experimental-import-meta-resolve
  describe('transitive dependencies', () => {
    const TEST_DIR = makeTestTempDir('packages-', {
      'index.js': 'root',
      'package.json': JSON.stringify({
        name: 'entry',
        version: '1.0.0',
        main: './index.js',
        dependencies: { foo: VOID_VERSION, bar: VOID_VERSION },
      }),
      dir: { 'sub.txt': 'content' },
      node_modules: {
        foo: {
          'index.js': 'foo',
          'package.json': JSON.stringify({
            name: 'foo',
            version: '1.0.0',
            dependencies: { bar: VOID_VERSION },
          }),
          node_modules: {
            bar: {
              'index.js': 'foobar',
              'package.json': JSON.stringify({ name: 'bar', version: '1.1.0' }),
            },
          },
        },
        bar: {
          'index.js': 'bar',
          'package.json': JSON.stringify({ name: 'bar', version: '1.0.0' }),
        },
      },
    });

    it('loads the full dependency tree', async ({ getTyped }) => {
      const packages = await readPackageGraph(join(getTyped(TEST_DIR), 'package.json'));
      const rootPackage = packages.find((o) => o.isRoot);
      expect(rootPackage?.packageJson.name).equals('entry');
      expect(rootPackage?.dependencies.has('foo')).isTrue();

      const fooPackage = packages.find((o) => o.id === rootPackage?.dependencies.get('foo'));
      expect(fooPackage?.packageJson.name).equals('foo');
      expect(fooPackage?.packageJson.version).equals('1.0.0');

      const barPackage = packages.find((o) => o.id === rootPackage?.dependencies.get('bar'));
      expect(barPackage?.packageJson.name).equals('bar');
      expect(barPackage?.packageJson.version).equals('1.0.0');

      const foobarPackage = packages.find((o) => o.id === fooPackage?.dependencies.get('bar'));
      expect(foobarPackage?.packageJson.name).equals('bar');
      expect(foobarPackage?.packageJson.version).equals('1.1.0');
    });

    it('loads file lists on request', async ({ getTyped }) => {
      const packages = await readPackageGraph(join(getTyped(TEST_DIR), 'package.json'));
      expect(await packages.find((o) => o.isRoot)?.getFilePaths()).equals(
        new Set(['./index.js', './package.json', './dir/sub.txt']),
      );
    });
  });
});

describe('getResolvedExportMap', () => {
  it('returns configured exports', () => {
    expect(
      getResolvedExportMap(
        {
          name: 'foo',
          exports: {
            './a': './a-target',
            './b': { default: './b-target' },
            './c': [{ default: './c-target' }],
            './d': null,
          },
        },
        new Set(),
      ),
    ).equals(
      new Map([
        ['./a', './a-target'],
        ['./b', './b-target'],
        ['./c', './c-target'],
        ['./d', null],
      ]),
    );
  });

  it('resolves conditions using the given environment', () => {
    const input: PackageJson = {
      name: 'foo',
      exports: {
        './a': { one: './a-one', two: './a-two', default: './a-default' },
        './b': { two: './b-two', one: './b-one', default: './b-default' },
        './c': { one: './c-one' },
        './d': { one: { two: './d-one-two' } },
      },
    };
    expect(getResolvedExportMap(input, new Set())).equals(
      new Map([
        ['./a', './a-default'],
        ['./b', './b-default'],
      ]),
    );
    expect(getResolvedExportMap(input, new Set(['one']))).equals(
      new Map([
        ['./a', './a-one'],
        ['./b', './b-one'],
        ['./c', './c-one'],
      ]),
    );
    expect(getResolvedExportMap(input, new Set(['two']))).equals(
      new Map([
        ['./a', './a-two'],
        ['./b', './b-two'],
      ]),
    );
    expect(getResolvedExportMap(input, new Set(['one', 'two']))).equals(
      new Map([
        ['./a', './a-one'],
        ['./b', './b-two'],
        ['./c', './c-one'],
        ['./d', './d-one-two'],
      ]),
    );
  });

  it('supports single-entrypoint shorthand', () => {
    expect(getResolvedExportMap({ name: 'foo', exports: './single.js' }, new Set())).equals(
      new Map([['.', './single.js']]),
    );

    expect(getResolvedExportMap({ name: 'foo', exports: null }, new Set())).equals(
      new Map([['.', null]]),
    );

    expect(
      getResolvedExportMap({ name: 'foo', exports: { default: './foo.txt' } }, new Set()),
    ).equals(new Map([['.', './foo.txt']]));

    expect(
      getResolvedExportMap({ name: 'foo', exports: [{ default: './foo.txt' }] }, new Set()),
    ).equals(new Map([['.', './foo.txt']]));
  });

  it('falls back to browser/module/main keys', () => {
    const input: PackageJson = {
      name: 'foo',
      browser: './browser.js',
      module: './module.mjs',
      main: './main.js',
    };

    expect(getResolvedExportMap(input, new Set())).equals(
      new Map([
        ['.', './main.js'],
        ['./*', './*'],
      ]),
    );
    expect(getResolvedExportMap(input, new Set(['browser']))).equals(
      new Map([
        ['.', './browser.js'],
        ['./*', './*'],
      ]),
    );
    expect(getResolvedExportMap(input, new Set(['module']))).equals(
      new Map([
        ['.', './module.mjs'],
        ['./*', './*'],
      ]),
    );
  });

  it('falls back to index.js', () => {
    expect(getResolvedExportMap({ name: 'foo' }, new Set())).equals(
      new Map([
        ['.', './index.js'],
        ['./*', './*'],
      ]),
    );
  });
});
