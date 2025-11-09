import { BlockingQueue } from './BlockingQueue.mts';
import 'lean-test';

describe('BlockingQueue', () => {
  it('behaves as a first-in-first-out queue', async () => {
    const queue = new BlockingQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.push(3);

    expect(await queue.shift()).equals(1);
    expect(await queue.shift()).equals(2);
    expect(await queue.shift()).equals(3);
  });

  it('blocks when polled while empty until an item is available', async () => {
    const queue = new BlockingQueue<number>();

    let resolved: number | null = null;
    queue.shift().then((v) => {
      resolved = v;
    });
    await Promise.resolve();
    expect(resolved).isNull();

    queue.push(2);
    await Promise.resolve();
    expect(resolved).equals(2);
  });

  it('throws if the timeout is reached before an item is available', async () => {
    const queue = new BlockingQueue<number>();

    // ensure we are not running alongside lots of slow synchronous tests that will slow us down.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const begin = Date.now();
    await expect(() => queue.shift(10)).throws('Timeout after 10ms');
    const end = Date.now();
    expect(end - begin).isLessThan(500);
  });

  it('throws if the queue has been closed', async () => {
    const queue = new BlockingQueue<number>();

    queue.close('gone');

    await expect(() => queue.shift()).throws('gone');
  });

  it('does not accept new items after closing', async () => {
    const queue = new BlockingQueue<number>();

    queue.close('gone');
    queue.push(1);

    await expect(() => queue.shift()).throws('gone');
  });

  it('throws if the queue is closed while waiting', async () => {
    const queue = new BlockingQueue<number>();

    let caught: unknown = null;
    queue.shift().catch((err) => {
      caught = err;
    });
    await Promise.resolve();
    expect(caught).isNull();

    queue.close('gone');

    await Promise.resolve();
    expect(caught).equals('gone');
  });

  it('throws if the queue has failed', async () => {
    const queue = new BlockingQueue<number>();

    queue.fail('oops');

    await expect(() => queue.shift()).throws('oops');
  });

  it('does not accept new items after failing', async () => {
    const queue = new BlockingQueue<number>();

    queue.fail('gone');
    queue.push(1);

    await expect(() => queue.shift()).throws('gone');
  });

  it('throws if the queue fails while waiting', async () => {
    const queue = new BlockingQueue<number>();

    let caught: unknown = null;
    queue.shift().catch((err) => {
      caught = err;
    });
    await Promise.resolve();
    expect(caught).isNull();

    queue.fail('oops');

    await Promise.resolve();
    expect(caught).equals('oops');
  });

  it('is async iterable', async () => {
    const queue = new BlockingQueue<number>();
    queue.push(1);
    queue.push(2);
    queue.push(3);
    queue.close('gone');
    queue.push(4);

    const seen: number[] = [];
    for await (const item of queue) {
      seen.push(item);
    }
    expect(seen).toEqual([1, 2, 3]);
  });

  it('async iterable throws if queue fails', async () => {
    const queue = new BlockingQueue<number>();
    queue.push(1);
    queue.fail('oops');
    queue.push(2);

    const seen: number[] = [];
    await expect(async () => {
      for await (const item of queue) {
        seen.push(item);
      }
    }).throws('oops');
    expect(seen).toEqual([1]);
  });
});
