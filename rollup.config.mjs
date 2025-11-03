import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import typescript from '@rollup/plugin-typescript';
import { dts } from 'rollup-plugin-dts';

export default [
  {
    input: 'src/index.mts',
    output: {
      dir: 'build',
      format: 'esm',
      paths: (p) => (p === 'stream' ? 'node:stream' : p), // patch busboy import
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
      nodeResolve(), // for bundling busboy
      commonjs(), // for bundling busboy
      terser({
        ecma: 2015,
        module: true,
        compress: { passes: 2, unsafe_arrows: true },
        format: { ascii_only: true, preserve_annotations: true },
        mangle: { properties: { regex: /^_/ } },
      }),
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
      terser({
        ecma: 2015,
        module: true,
        compress: { passes: 2, unsafe_arrows: true },
        format: { ascii_only: true, preserve_annotations: true },
        mangle: { properties: { regex: /^_/ } },
      }),
    ],
  },
  {
    input: './build/types/src/index.d.mts',
    output: [{ file: 'build/index.d.ts', format: 'esm' }],
    external: [/node:.*/],
    plugins: [dts()],
  },
];
