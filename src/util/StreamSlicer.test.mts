import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';
import { StreamSlicer } from './StreamSlicer.mts';
import 'lean-test';

describe('StreamSlicer', () => {
  it('extracts sequential non-overlapping ranges from an underlying stream', async () => {
    const input = new Uint8Array(sequence(100));
    const slicer = new StreamSlicer(ReadableStream.from([input]));
    expect(await read(slicer.getRange(5, 20))).equals([input.subarray(5, 21)]);
    expect(await read(slicer.getRange(25, 25))).equals([input.subarray(25, 26)]);
    expect(await read(slicer.getRange(26, 40))).equals([input.subarray(26, 41)]);
    expect(await read(slicer.getRange(90, 99))).equals([input.subarray(90, 100)]);
    slicer.close();
  });

  it('handles slices which cross input chunk boundaries', async () => {
    const input = new Uint8Array(sequence(50));
    const slicer = new StreamSlicer(
      ReadableStream.from([
        input.subarray(0, 10),
        input.subarray(10, 20),
        input.subarray(20, 30),
        input.subarray(30, 40),
        input.subarray(40, 50),
      ]),
    );
    expect(await read(slicer.getRange(5, 20))).equals([
      input.subarray(5, 10),
      input.subarray(10, 20),
      input.subarray(20, 21),
    ]);
    expect(await read(slicer.getRange(25, 25))).equals([input.subarray(25, 26)]);
    expect(await read(slicer.getRange(26, 40))).equals([
      input.subarray(26, 30),
      input.subarray(30, 40),
      input.subarray(40, 41),
    ]);
    expect(await read(slicer.getRange(45, 49))).equals([input.subarray(45, 50)]);
    slicer.close();
  });

  it('works with Node.js Readable', async () => {
    const input = Buffer.from(sequence(100));
    const slicer = new StreamSlicer(Readable.from([input]));
    expect(await read(slicer.getRange(5, 20))).equals([input.subarray(5, 21)]);
    expect(await read(slicer.getRange(25, 25))).equals([input.subarray(25, 26)]);
    expect(await read(slicer.getRange(26, 40))).equals([input.subarray(26, 41)]);
    expect(await read(slicer.getRange(90, 99))).equals([input.subarray(90, 100)]);
    slicer.close();
  });

  it('works with Node.js Readable of string', async () => {
    const slicer = new StreamSlicer(Readable.from(['hello']));
    expect(await read(slicer.getRange(1, 2))).equals([Buffer.from('el')]);
    expect(await read(slicer.getRange(3, 3))).equals([Buffer.from('l')]);
    slicer.close();
  });

  it('throws if the range exceeds the content', async () => {
    const input = new Uint8Array(sequence(100));
    const slicer = new StreamSlicer(ReadableStream.from([input]));
    await expect(() => read(slicer.getRange(70, 100))).throws('range exceeds content');
    slicer.close();
  });

  it('rejects non-sequential or overlapping ranges', async () => {
    const input = new Uint8Array(sequence(100));
    const slicer = new StreamSlicer(ReadableStream.from([input]));
    await read(slicer.getRange(5, 20));
    expect(() => slicer.getRange(20, 25)).throws('non-sequential range');
    expect(() => slicer.getRange(1, 2)).throws('non-sequential range');
    expect(() => slicer.getRange(30, 25)).throws('invalid range');
    slicer.close();
  });

  it('rejects negative ranges', () => {
    const input = new Uint8Array(sequence(100));
    const slicer = new StreamSlicer(ReadableStream.from([input]));
    expect(() => slicer.getRange(30, 29)).throws('invalid range');
    slicer.close();
  });

  it('rejects requesting a second range before the first has completed', async () => {
    const input = new Uint8Array(sequence(100));
    const slicer = new StreamSlicer(ReadableStream.from([input]));
    slicer.getRange(5, 20);
    expect(() => slicer.getRange(30, 40)).throws('previous range still active');
    slicer.close();
  });

  it('closes the input stream when closed', async () => {
    const input = ReadableStream.from([new Uint8Array(10)]);
    const slicer = new StreamSlicer(input);
    await slicer.close();
    expect(await input.getReader().read()).hasProperty('done', isTrue());
  });
});

function sequence(size: number) {
  const out: number[] = [];
  for (let i = 0; i < size; ++i) {
    out.push(i);
  }
  return out;
}

async function read(readable: ReadableStream): Promise<unknown[]> {
  const output: unknown[] = [];
  for await (const chunk of readable) {
    output.push(chunk);
  }
  return output;
}
