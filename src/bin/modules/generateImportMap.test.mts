import type { PackageInfo, PackageJson } from './PackageInfo.mts';
import { generateImportMap } from './generateImportMap.mts';
import 'lean-test';

describe('generateImportMap', () => {
  it('links defined exports', async () => {
    const result = await generateImportMap(
      [
        makePackage('a', 'root-pkg', {
          isRoot: true,
          exports: { '.': './f1' },
          dependencies: { foo: 'b', bar: 'c' },
        }),
        makePackage('b', 'foo', {
          exports: { '.': './f3', './f4-mapped': './f4' },
          dependencies: { bar: 'c' },
        }),
        makePackage('c', 'bar', { exports: { '.': './f5' } }),
      ],
      new Set(),
      '/base',
      '/src',
      (packageJson) => packageJson.name,
    );

    expect(result.importMap).equals({
      imports: {
        'root-pkg': '/src/f1',
        foo: '/base/foo/f3',
        'foo/f4-mapped': '/base/foo/f4',
        bar: '/base/bar/f5',
      },
      scopes: {},
    });
  });

  it('uses main if exports is not specified', async () => {
    const result = await generateImportMap(
      [
        makePackage('a', 'root-pkg', {
          isRoot: true,
          main: './index.js',
          dependencies: { foo: 'b', bar: 'c' },
        }),
        makePackage('b', 'foo', {
          main: './f3',
          dependencies: { bar: 'c' },
        }),
        makePackage('c', 'bar'),
      ],
      new Set(),
      '/base',
      '/src',
      (packageJson) => packageJson.name,
    );

    expect(result.importMap).equals({
      imports: {
        foo: '/base/foo/f3',
        'foo/index.js': '/base/foo/index.js',
        'foo/package.json': '/base/foo/package.json',
        bar: '/base/bar/index.js',
        'bar/index.js': '/base/bar/index.js',
        'bar/package.json': '/base/bar/package.json',
      },
      scopes: {},
    });
  });

  it('drops trailing slashes from path roots', async () => {
    const result = await generateImportMap(
      [
        makePackage('a', 'root-pkg', {
          isRoot: true,
          exports: './index.js',
          dependencies: { foo: 'b' },
        }),
        makePackage('b', 'foo', { exports: './index.js' }),
      ],
      new Set(),
      '/base/',
      '/src/',
      (packageJson) => packageJson.name,
    );

    expect(result.importMap).equals({
      imports: {
        'root-pkg': '/src/index.js',
        foo: '/base/foo/index.js',
      },
      scopes: {},
    });
  });

  it('returns file to path mappings', async () => {
    const result = await generateImportMap(
      [
        makePackage('a', 'root-pkg', { isRoot: true, dependencies: { foo: 'b', bar: 'c' } }),
        makePackage('b', 'foo', { dependencies: { bar: 'c' } }),
        makePackage('c', 'bar'),
      ],
      new Set(),
      '/base',
      '/src',
      (packageJson) => packageJson.name,
    );

    expect(result.hostedDirs).equals([
      { dir: '/path/for/b', path: 'foo' },
      { dir: '/path/for/c', path: 'bar' },
    ]);
  });

  it('uses scopes to set mapping overrides', async () => {
    const result = await generateImportMap(
      [
        makePackage('a', 'root-pkg', {
          isRoot: true,
          exports: { '.': './f1' },
          dependencies: { foo: 'b', bar: 'c' },
        }),
        makePackage('b', 'foo', {
          exports: { '.': './f3', './f4-mapped': './f4' },
          dependencies: { bar: 'd' },
        }),
        makePackage('c', 'bar', { exports: { '.': './f5' } }),
        makePackage('d', 'bar', { exports: { '.': './f7' } }),
      ],
      new Set(),
      '/base',
      '/src',
      (packageJson) => packageJson.name,
    );

    expect(result.importMap).equals({
      imports: {
        'root-pkg': '/src/f1',
        foo: '/base/foo/f3',
        'foo/f4-mapped': '/base/foo/f4',
        bar: '/base/bar/f5',
      },
      scopes: {
        '/base/foo/': { bar: '/base/bar_2/f7' },
        '/base/bar_2/': { bar: '/base/bar_2/f7' },
      },
    });
  });

  it('resolves wildcard exports', async () => {
    const result = await generateImportMap(
      [
        makePackage('a', 'root-pkg', { isRoot: true, dependencies: { foo: 'b' } }),
        makePackage('b', 'foo', {
          exports: { '.': './f1', './*.hmm': './*.ts' },
          files: ['./f1', './f2', './f3.js', './f4.ts'],
        }),
      ],
      new Set(),
      '/base',
      '/src',
      (packageJson) => packageJson.name,
    );

    expect(result.importMap).equals({
      imports: {
        foo: '/base/foo/f1',
        'foo/f4.hmm': '/base/foo/f4.ts',
      },
      scopes: {},
    });
  });

  it('favours more specific mappings regardless of input order', async () => {
    const files = ['./f1', './f2', './f31', './f32'];
    const expected = {
      imports: {
        'foo/1': '/base/foo/f1',
        'foo/2': '/base/foo/f1',
        'foo/31': '/base/foo/f1',
        'foo/32': '/base/foo/f2',
        'foo/331': '/base/foo/f31',
        'foo/332': '/base/foo/f32',
      },
      scopes: {},
    };

    const result1 = await generateImportMap(
      [
        makePackage('a', 'root-pkg', { isRoot: true, dependencies: { foo: 'b' } }),
        makePackage('b', 'foo', {
          exports: { './*': './f*', './3*': './f*', './2': './f1' },
          files,
        }),
      ],
      new Set(),
      '/base',
      '/src',
      (packageJson) => packageJson.name,
    );
    expect(result1.importMap).equals(expected);

    const result2 = await generateImportMap(
      [
        makePackage('a', 'root-pkg', { isRoot: true, dependencies: { foo: 'b' } }),
        makePackage('b', 'foo', {
          exports: { './2': './f1', './3*': './f*', './*': './f*' },
          files,
        }),
      ],
      new Set(),
      '/base',
      '/src',
      (packageJson) => packageJson.name,
    );
    expect(result2.importMap).equals(expected);
  });

  it('does not expose inputs mapped to null', async () => {
    const result = await generateImportMap(
      [
        makePackage('a', 'root-pkg', { isRoot: true, dependencies: { foo: 'b' } }),
        makePackage('b', 'foo', {
          exports: { '.': './f1', './f2': null, './*': './*', './f3*': null },
          files: ['./f1', './f2', './f3', './f31', './f4'],
        }),
      ],
      new Set(),
      '/base',
      '/src',
      (packageJson) => packageJson.name,
    );

    expect(result.importMap).equals({
      imports: {
        foo: '/base/foo/f1',
        'foo/f1': '/base/foo/f1',
        'foo/f4': '/base/foo/f4',
      },
      scopes: {},
    });
  });

  it('resolves imports', async () => {
    const result = await generateImportMap(
      [
        makePackage('a', 'root-pkg', {
          isRoot: true,
          imports: { '#one': 'foo/other', '#two/*': 'foo/f*', '#three': './thing' },
          dependencies: { foo: 'b' },
        }),
        makePackage('b', 'foo', {
          imports: { '#one': './something' },
          exports: { '.': './f1', './other': './other', './*.hmm': './*.ts' },
          files: ['./f1', './f2', './f3.js', './f4.ts'],
        }),
      ],
      new Set(),
      '/base',
      '/src',
      (packageJson) => packageJson.name,
    );

    expect(result.importMap).equals({
      imports: {
        foo: '/base/foo/f1',
        'foo/other': '/base/foo/other',
        'foo/f4.hmm': '/base/foo/f4.ts',
        '#one': '/base/foo/other',
        '#two/4.hmm': '/base/foo/f4.ts',
        '#three': '/src/thing',
      },
      scopes: { '/base/foo/': { '#one': '/base/foo/something' } },
    });
  });
});

function makePackage(
  id: string,
  name: string,
  {
    isRoot = false,
    files = ['./index.js', './package.json'],
    dependencies = {},
    ...packageJson
  }: {
    isRoot?: boolean;
    files?: string[];
    dependencies?: Record<string, string>;
  } & Partial<Omit<PackageJson, 'name'>> = {},
): PackageInfo {
  return {
    isRoot,
    id,
    dir: '/path/for/' + id,
    getFilePaths: () => new Set(files),
    packageJson: { name, ...packageJson },
    dependencies: new Map(Object.entries(dependencies)),
  };
}
