import type { Writable } from 'node:stream';
import assert from 'node:assert';

export async function profile<T>(
  name: string,
  fn: () => T,
  correctAnswer: T,
  runsPerBatch = 1000,
): Promise<ProfilerResult> {
  // we measure the best time rather than the average because this is more likely to
  // represent the actual performance of the algorithm (when it is not interrupted by
  // other tasks such as garbage collection or OS activity)
  let totalTime = 0;
  let batches = 0;
  let bestTime = Number.POSITIVE_INFINITY;
  const deadline = Date.now() + 500;
  do {
    for (let run = 0; run < runsPerBatch; ++run) {
      const tm0 = performance.now();
      const answer = fn();
      const time = performance.now() - tm0;
      totalTime += time;
      if (time < bestTime) {
        bestTime = time;
      }
      assert.deepStrictEqual(answer, correctAnswer, `Incorrect answer when profiling ${name}`);
    }
    ++batches;
    await new Promise((resolve) => setTimeout(resolve, 0));
  } while (Date.now() < deadline);

  return { bestTime, totalTime, totalRuns: batches * runsPerBatch };
}

export interface ProfilerResult {
  bestTime: number;
  totalTime: number;
  totalRuns: number;
}

export function splitChunks(content: Buffer, chunkSize: number) {
  const split: Buffer[] = [];
  for (let i = 0; i < content.byteLength; i += chunkSize) {
    split.push(content.subarray(i, Math.min(i + chunkSize, content.byteLength)));
  }
  return split;
}

export function drawTable(target: Writable, headers: (string | { name: string; size: number })[]) {
  const widths = headers.map((h) =>
    typeof h === 'string' ? h.length : Math.max(h.size, h.name.length),
  );
  for (let column = 0; column < headers.length; ++column) {
    let header = headers[column]!;
    const w = widths[column]!;
    if (typeof header !== 'string') {
      header = header.name;
    }
    target.write(`| ${header.padEnd(w, ' ')} `);
  }
  target.write('|\n');
  for (const w of widths) {
    target.write(`| ${'-'.repeat(w)} `);
  }
  target.write('|\n');

  let column = 0;
  return (cellValue: string, align: 'left' | 'right' = 'left') => {
    const w = widths[column]!;
    const padded = align === 'left' ? cellValue.padEnd(w, ' ') : cellValue.padStart(w, ' ');
    target.write(`| ${padded.slice(0, w)} `);
    ++column;
    if (column === widths.length) {
      target.write('|\n');
      column = 0;
    }
  };
}

export function makeList<T>(size: number, generator: (i: number) => T): T[] {
  const result: T[] = [];
  for (let i = 0; i < size; ++i) {
    result.push(generator(i));
  }
  return result;
}
