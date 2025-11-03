import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';
import { internalIsFileHandle } from './isFileHandle.mts';
import 'lean-test';

describe('isFileHandle', () => {
  it('returns true for Node.js FileHandle objects', async () => {
    const handle = await open('.');
    try {
      expect(internalIsFileHandle(handle)).isTrue();
    } finally {
      await handle.close();
    }
  });

  it('returns false for Node.js Readable objects', () => {
    const readable = Readable.from('123');
    expect(internalIsFileHandle(readable)).isFalse();
  });

  it('returns false for Web Stream ReadableStream objects', () => {
    const readable = ReadableStream.from('123');
    expect(internalIsFileHandle(readable)).isFalse();
  });

  it('returns false for non-objects and miscellaneous objects', () => {
    expect(internalIsFileHandle(0)).isFalse();
    expect(internalIsFileHandle(null)).isFalse();
    expect(internalIsFileHandle(undefined)).isFalse();
    expect(internalIsFileHandle('')).isFalse();
    expect(internalIsFileHandle('nope')).isFalse();
    expect(internalIsFileHandle({})).isFalse();
    expect(internalIsFileHandle(Symbol())).isFalse();
  });
});
