import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import { dts } from 'rollup-plugin-dts';

const TERSER_OPTS = {
  ecma: 2015,
  module: true,
  compress: { passes: 2, unsafe_arrows: true },
  format: { ascii_only: true, preserve_annotations: true },
  mangle: {
    properties: { regex: /^_/ },
  },
};

export default [
  {
    input: 'src/index.mts',
    output: {
      dir: 'build',
      format: 'esm',
    },
    external: [/node:.*/],
    plugins: [
      typescript({
        compilerOptions: {
          noEmit: false,
          declaration: true,
          rewriteRelativeImportExtensions: true,
          rootDir: '.',
          declarationDir: './build/types',
        },
        include: ['src/**'],
        exclude: ['**/*.test.*', 'src/test-helpers/**', 'src/bin/**'],
        tslib: {},
      }),
      terser(TERSER_OPTS),
    ],
  },
  {
    input: 'src/bin/run.mts',
    output: {
      dir: 'build',
      format: 'esm',
      paths: (p) => p.replace(/^.+\/src\/index\..*$/, './index.js'),
    },
    external: [/node:.*/, /\/src\/(?!bin\/)/],
    plugins: [
      typescript({
        rewriteRelativeImportExtensions: true,
        compilerOptions: { rootDir: '.' },
        include: ['src/bin/**'],
        exclude: ['**/*.test.*'],
        tslib: {},
      }),
      terser(TERSER_OPTS),
    ],
  },
  {
    input: './build/types/src/index.d.mts',
    output: [{ file: 'build/index.d.ts', format: 'esm' }],
    external: [/node:.*/],
    plugins: [dts()],
  },
];
