import { nodeResolve } from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';

export default {
  input: 'mini.input.mjs',
  output: { file: 'mini.output.mjs', format: 'esm' },
  external: [/node:.*/],
  plugins: [nodeResolve(), terser()],
};
