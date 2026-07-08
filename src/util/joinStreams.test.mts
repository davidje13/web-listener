import { open } from 'node:fs/promises';
import { text } from 'node:stream/consumers';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { joinStreams } from './joinStreams.mts';
import 'lean-test';

describe('joinStreams', () => {
  it('produces a single stream containing each input in sequence', async () => {
    const joined = joinStreams(
      {},
      () => Readable.from(['one'], { encoding: 'utf-8' }),
      () => Readable.from(['two'], { encoding: 'utf-8' }),
      () => Readable.from(['three'], { encoding: 'utf-8' }),
    );
    expect(await text(joined)).equals('onetwothree');
  });

  it('includes buffer content', async () => {
    const joined = joinStreams(
      {},
      Buffer.from('one', 'utf-8'),
      Buffer.from('two', 'utf-8'),
      Buffer.from('three', 'utf-8'),
    );
    expect(await text(joined)).equals('onetwothree');
  });

  it('skips nulls', async () => {
    const joined = joinStreams(
      {},
      null,
      Buffer.from('one', 'utf-8'),
      null,
      null,
      Buffer.from('two', 'utf-8'),
      null,
      Buffer.from('three', 'utf-8'),
      null,
    );
    expect(await text(joined)).equals('onetwothree');
  });

  it('returns a non-wrapped stream if there is only one source', async () => {
    const source = Readable.from(['one'], { encoding: 'utf-8' });
    const joined = joinStreams({}, null, () => source, null);
    expect(joined).same(source);
  });

  it('retuns an empty stream if there are no sources', async () => {
    expect(await text(joinStreams({}))).equals('');
    expect(await text(joinStreams({}, null))).equals('');
  });

  it('respects autoClose of contained streams', async () => {
    const handle1 = await open(fileURLToPath(import.meta.url));
    try {
      const joined = joinStreams(
        {},
        () => handle1.createReadStream({ start: 0, end: 0, autoClose: false }),
        () => handle1.createReadStream({ start: 1, end: 1, autoClose: false }),
      );
      expect(await text(joined)).hasLength(2);
      expect(await handle1.stat()).isTruthy();
    } finally {
      handle1.close();
    }

    const handle2 = await open(fileURLToPath(import.meta.url));
    try {
      const joined = joinStreams(
        {},
        () => handle2.createReadStream({ start: 0, end: 0, autoClose: true }),
        Buffer.from('extra', 'utf-8'),
      );
      expect(await text(joined)).hasLength(6);
      await expect(() => handle2.stat()).throws('file closed');
    } finally {
      handle2.close();
    }
  });

  it('propagates errors from component streams', async () => {
    const joined = joinStreams({}, Buffer.from('prefix'), () =>
      Readable.from(
        (function* () {
          yield 'one';
          yield 'two';
          throw new Error('oops');
        })(),
      ),
    );
    await expect(() => text(joined)).throws('oops');
  });
});
