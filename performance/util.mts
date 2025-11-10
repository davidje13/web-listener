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
  const deadline = Date.now() + 100;
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
