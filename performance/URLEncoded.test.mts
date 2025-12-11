#!/usr/bin/env -S node --disable-proto=throw --disallow-code-generation-from-strings --force-node-api-uncaught-exceptions-policy --no-addons --pending-deprecation --throw-deprecation --frozen-intrinsics --no-warnings=ExperimentalWarning
import OriginalBusboy from 'busboy';
import { busboy } from '../src/forks/busboy/busboy.mts';
import { drawTable, makeList, profile, splitChunks, type ProfilerResult } from './util.mts';

const implementations: ImplementationDef[] = [
  {
    name: 'this project',
    run: (chunks) => () => {
      const r: unknown[] = [];
      const o = busboy({ 'content-type': 'application/x-www-form-urlencoded' });
      o.on('field', ({ name, value }) => r.push({ name, value }));
      for (const chunk of chunks) {
        o.write(chunk);
      }
      o.end();
      return r;
    },
  },
  {
    name: 'busboy@1.6.0',
    run: (chunks) => () => {
      const r: unknown[] = [];
      const o = OriginalBusboy({
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        defCharset: 'utf-8',
      });
      o.on('field', (name, value) => r.push({ name, value }));
      for (const chunk of chunks) {
        o.write(chunk);
      }
      o.end();
      return r;
    },
  },
];

const inputs: InputDef[] = [
  {
    name: 'lots of small fields',
    ...makeInput(makeList(1000, (i) => [`f${i}`, 'value'])),
  },
  {
    name: 'large ascii',
    ...makeInput([['thing', 'a'.repeat(50000)]]),
  },
  {
    name: 'percent encoded',
    ...makeInput([['thing', '&'.repeat(2000)]]),
  },
  {
    name: 'unicode',
    ...makeInput([['thing', '\u2026'.repeat(2000)]]),
  },
  {
    name: 'mixed',
    ...makeInput([
      [
        'thing',
        'This is a long and (moderately) realistic value which is mostly regular ASCII, but has encoded characters (e.g. spaces & some punctuation), and a little bit of unicode \u236A'.repeat(
          100,
        ),
      ],
    ]),
  },
  {
    name: 'mix of fields',
    ...makeInput([
      ...makeList<[string, string]>(100, (i) => [`f${i}`, 'value']),
      ['content', 'a'.repeat(10000) + '\u2026'],
    ]),
  },
];
const chunkSizes = [100000, 2000, 100];

interface ImplementationDef {
  name: string;
  run: (chunks: Buffer[]) => () => unknown[];
}

interface InputDef {
  name: string;
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
      const result = await profile(implementation.name, implementation.run(chunks), input.answer);
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

function makeInput(fields: [string, string][]) {
  return {
    content: Buffer.from(
      fields
        .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
        .join('&'),
      'utf-8',
    ),
    answer: fields.map(([name, value]) => ({ name, value })),
  };
}
