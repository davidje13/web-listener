#!/usr/bin/env -S node --disable-proto=throw --disallow-code-generation-from-strings --force-node-api-uncaught-exceptions-policy --no-addons --pending-deprecation --throw-deprecation --frozen-intrinsics --no-warnings=ExperimentalWarning
import { randomFillSync } from 'node:crypto';
import OriginalStreamSearch from 'streamsearch';
import { StreamSearch } from '../src/forks/streamsearch/sbmh.mts';
import { drawTable, profile, splitChunks, type ProfilerResult } from './util.mts';

const implementations: ImplementationDef[] = [
  {
    name: 'this project',
    run: (needle, haystack) => () => {
      let n = 0;
      const needleLen = needle.byteLength;
      const r: number[] = [];
      const ss = new StreamSearch(
        needle,
        (_data, start, end) => {
          n += end - start;
        },
        () => {
          r.push(n);
          n += needleLen;
        },
      );
      for (const chunk of haystack) {
        ss.push(chunk);
      }
      ss.destroy();
      return r;
    },
    multi: true,
  },
  {
    name: 'streamsearch@1.1.0',
    run: (needle, haystack) => () => {
      let n = 0;
      const needleLen = needle.byteLength;
      const r: number[] = [];
      const ss = new OriginalStreamSearch(needle, (match, _data, start, end) => {
        n += end - start;
        if (match) {
          r.push(n);
          n += needleLen;
        }
      });
      for (const chunk of haystack) {
        ss.push(chunk);
      }
      ss.destroy();
      return r;
    },
    multi: true,
  },
  {
    name: 'Buffer.indexOf',
    run: (needle, haystack) => () => {
      const h = haystack[0];
      const needleLen = needle.byteLength;
      const r: number[] = [];
      for (let pos = 0; (pos = h.indexOf(needle, pos)) !== -1; ) {
        r.push(pos);
        pos += needleLen;
      }
      return r;
    },
    multi: false,
  },
];

const needles: NeedleDef[] = [
  { name: '\\r\\n', value: Buffer.from('\r\n') },
  { name: '\\r\\n--sep', value: Buffer.from('\r\n--sep') },
  {
    name: 'realistic',
    value: Buffer.from(`\r\n${'-'.repeat(30)}paZqsnEHRufoShdX6fh0lUhXBP4k`),
  },
  { name: 'repetitive prefixed', value: Buffer.from('.' + '-'.repeat(100)) },
  { name: 'long repetitive prefixed', value: Buffer.from('.' + '-'.repeat(1000)) },
  { name: 'repetitive suffixed', value: Buffer.from('-'.repeat(100) + '.') },
  { name: 'long repetitive suffixed', value: Buffer.from('-'.repeat(1000) + '.') },
];

const chunkSizes = [100000, 2000, 100];

interface ImplementationDef {
  name: string;
  run: (needle: Buffer, haystack: Buffer[]) => () => number[];
  multi: boolean;
}

interface NeedleDef {
  name: string;
  value: Buffer;
}

const haystackSize = 100000;
const needlePositions = [200, 2000, 9570, 29990, 32000, 79999, 85500, 87000, 89995];
process.stdout.write(`${needlePositions.length} separators in a ${haystackSize}-byte source\n`);
process.stdout.write('\n');

const table = drawTable(process.stdout, [
  { name: 'Test', size: Math.max(...needles.map(({ name }) => name.length)) },
  'Chunk Size',
  ...implementations.map((i) => i.name),
]);

for (const needle of needles) {
  const haystack = buildHaystack(haystackSize, needle.value, needlePositions);
  for (const chunkSize of chunkSizes) {
    table(needle.name);
    table(chunkSize.toString(), 'right');
    const chunks = splitChunks(haystack, chunkSize);
    const results: (ProfilerResult | null)[] = [];
    let best = -1;
    for (const implementation of implementations) {
      if (chunks.length > 1 && !implementation.multi) {
        results.push(null);
        continue;
      }
      const result = await profile(
        implementation.name,
        implementation.run(needle.value, [haystack]),
        needlePositions,
      );
      results.push(result);
      if (best === -1 || result.bestTime < results[best]!.bestTime) {
        best = results.length - 1;
      }
    }
    for (let i = 0; i < results.length; ++i) {
      const result = results[i];
      if (!result) {
        table('n/a', 'right');
      } else {
        let value = `${(result.bestTime * 1000).toFixed(1)}\u00B5s`;
        if (best === i) {
          value = '* ' + value;
        }
        table(value, 'right');
      }
    }
  }
}

function buildHaystack(size: number, needle: Buffer, needlePositions: number[]) {
  const haystack = randomFillSync(Buffer.allocUnsafe(size));
  // add some needle fragments to keep things interesting
  for (let i = 0; i < size - needle.byteLength; i += (1 + (Math.random() * size) / 4) | 0) {
    const p = (Math.random() * (needle.length - 1)) | 0;
    if (Math.random() < 0.5) {
      haystack.set(needle.subarray(0, p), i);
    } else {
      haystack.set(needle.subarray(p + 1), i);
    }
  }
  // remove any occurrences of the needle that appeared by random chance
  for (let pos = 0; (pos = haystack.indexOf(needle, pos)) !== -1; ) {
    pos += needle.length - 1;
    haystack[pos] = (haystack[pos] + 1) & 0xff;
  }
  for (const needlePos of needlePositions) {
    haystack.set(needle, needlePos);
    if (haystack.indexOf(needle, Math.max(0, needlePos - needle.byteLength)) !== needlePos) {
      haystack[needlePos - 1] = (haystack[needlePos - 1] + 1) & 0xff;
    }
  }
  return haystack;
}
