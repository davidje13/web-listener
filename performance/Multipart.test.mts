#!/usr/bin/env -S node --disable-proto=throw --disallow-code-generation-from-strings --force-node-api-uncaught-exceptions-policy --no-addons --pending-deprecation --throw-deprecation --frozen-intrinsics --no-warnings=ExperimentalWarning
import OriginalBusboy from 'busboy';
import { busboy } from '../src/forks/busboy/busboy.mts';
import { drawTable, makeList, profile, splitChunks, type ProfilerResult } from './util.mts';
import { buffer } from 'node:stream/consumers';

const implementations: ImplementationDef[] = [
  {
    name: 'this project',
    run: (chunks, boundary) => () =>
      new Promise((resolve) => {
        let n = 0;
        const r: unknown[] = [];
        const o = busboy({ 'content-type': `multipart/form-data; boundary=${boundary}` });
        o.on('field', (name, value) => r.push({ name, value }));
        o.on('file', async (name, stream) => {
          ++n;
          r.push({ name, data: await buffer(stream) });
          if (!--n) {
            resolve(r);
          }
        });
        for (const chunk of chunks) {
          o.write(chunk);
        }
        o.end();
        if (!n) {
          resolve(r);
        }
      }),
  },
  {
    name: 'busboy@1.6.0',
    run: (chunks, boundary) => () =>
      new Promise((resolve) => {
        let n = 0;
        const r: unknown[] = [];
        const o = OriginalBusboy({
          headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
          defCharset: 'utf-8',
        });
        o.on('field', (name, value) => r.push({ name, value }));
        o.on('file', async (name, stream) => {
          ++n;
          r.push({ name, data: await buffer(stream) });
          if (!--n) {
            resolve(r);
          }
        });
        for (const chunk of chunks) {
          o.write(chunk);
        }
        o.end();
        if (!n) {
          resolve(r);
        }
      }),
  },
];

const BOUNDARY = '------WebKitFormBoundaryTB2MiQ36fnSJlrhY';
const LARGE_FILE = Buffer.from('a'.repeat(1000000), 'utf-8');

const inputs: InputDef[] = [
  {
    name: 'small fields',
    boundary: BOUNDARY,
    ...makeInput(
      makeList(20, (i) => [`f${i}`, 'value']),
      BOUNDARY,
    ),
  },
  {
    name: 'lots of small fields',
    boundary: BOUNDARY,
    ...makeInput(
      makeList(500, (i) => [`f${i}`, 'value']),
      BOUNDARY,
    ),
  },
  {
    name: 'large field',
    boundary: BOUNDARY,
    ...makeInput(
      makeList(1, (i) => [`f${i}`, 'a'.repeat(100000)]),
      BOUNDARY,
    ),
  },
  {
    name: 'large file upload',
    boundary: BOUNDARY,
    content: Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="upload"; filename="in.txt"\r\n\r\n`,
        'utf-8',
      ),
      LARGE_FILE,
      Buffer.from(`\r\n--${BOUNDARY}--`, 'utf-8'),
    ]),
    answer: [{ name: 'upload', data: LARGE_FILE }],
  },
];
const chunkSizes = [100000, 2000, 100];

interface ImplementationDef {
  name: string;
  run: (chunks: Buffer[], boundary: string) => () => Promise<unknown[]>;
}

interface InputDef {
  name: string;
  boundary: string;
  content: Buffer;
  answer: unknown[];
}

const table = drawTable(process.stdout, [
  { name: 'Test', size: Math.max(...inputs.map(({ name }) => name.length)) },
  'Chunk Size',
  ...implementations.map((i) => i.name),
]);

for (const input of inputs) {
  for (const chunkSize of chunkSizes) {
    table(input.name);
    table(chunkSize.toString(), 'right');
    const chunks = splitChunks(input.content, chunkSize);
    const results: ProfilerResult[] = [];
    let best = -1;
    for (const implementation of implementations) {
      const result = await profile(
        implementation.name,
        implementation.run(chunks, input.boundary),
        input.answer,
      );
      results.push(result);
      if (best === -1 || result.bestTime < results[best]!.bestTime) {
        best = results.length - 1;
      }
    }
    for (let i = 0; i < results.length; ++i) {
      const result = results[i]!;
      let value = `${(result.bestTime * 1000).toFixed(1)}\u00B5s`;
      if (best === i) {
        value = '* ' + value;
      }
      table(value, 'right');
    }
  }
}

function makeInput(fields: [string, string][], boundary: string) {
  return {
    content: Buffer.from(
      fields
        .map(
          ([name, value]) =>
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        )
        .join('') + `--${boundary}--`,
      'utf-8',
    ),
    answer: fields.map(([name, value]) => ({ name, value })),
  };
}
