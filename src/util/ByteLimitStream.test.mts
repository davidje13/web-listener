import { ReadableStream } from 'node:stream/web';
import { ByteLimitStream } from './ByteLimitStream.mts';
import 'lean-test';

describe('ByteLimitStream', () => {
  it('is a no-op passthrough if the stream is not over the limit', async () => {
    const limiter = new ByteLimitStream(20, new Error('too much'));

    const input = [Buffer.alloc(2), Buffer.alloc(3)];
    const output: unknown[] = [];
    for await (const chunk of ReadableStream.from(input).pipeThrough(limiter)) {
      output.push(chunk);
    }
    expect(output).equals(input);
  });

  it('errors and stops the stream if the length goes over the byte limit', async () => {
    const limiter = new ByteLimitStream(20, new Error('too much'));

    const input = [Buffer.alloc(2), Buffer.alloc(19), Buffer.alloc(1)];
    const output: unknown[] = [];
    await expect(async () => {
      for await (const chunk of ReadableStream.from(input).pipeThrough(limiter)) {
        output.push(chunk);
      }
    }).throws('too much');
    expect(output).equals(input.slice(0, 1));
  });
});
