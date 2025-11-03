import { ReadableStream } from 'node:stream/web';
import { UTF32Decoder } from './UTF32Decoder.mts';
import 'lean-test';

describe('UTF32Decoder', () => {
  describe('big endian utf-32-be', () => {
    it('decodes a string from a byte stream', async () => {
      const decoder = new UTF32Decoder(false);

      const input = [
        new Uint8Array([0x00, 0x00, 0x00, 0x41, 0x00, 0x01, 0xf6, 0x00, 0x00, 0x01, 0xf6, 0x01]),
      ];
      expect(await pipe(input, decoder)).equals(['A\u{1f600}\u{1f601}']);
    });

    it('works with Buffer', async () => {
      const decoder = new UTF32Decoder(false);

      const input = [
        Buffer.from([0x00, 0x00, 0x00, 0x41, 0x00, 0x01, 0xf6, 0x00, 0x00, 0x01, 0xf6, 0x01]),
      ];
      expect(await pipe(input, decoder)).equals(['A\u{1f600}\u{1f601}']);
    });

    it('handles characters split between chunks', async () => {
      const decoder = new UTF32Decoder(false);

      const input = [
        new Uint8Array([0x00]),
        new Uint8Array([0x00]),
        new Uint8Array([0x00, 0x41, 0x00, 0x01]),
        new Uint8Array([0xf6, 0x00]),
        new Uint8Array([0x00, 0x01, 0xf6]),
        new Uint8Array([0x01]),
      ];
      expect(await pipe(input, decoder)).equals(['A', '\u{1f600}', '\u{1f601}']);
    });
  });

  describe('little endian utf-32-le', () => {
    it('decodes a string from a byte stream', async () => {
      const decoder = new UTF32Decoder(true);

      const input = [new Uint8Array([0x41, 0x00, 0x00, 0x00, 0x00, 0xf6, 0x01, 0x00])];
      expect(await pipe(input, decoder)).equals(['A\u{1f600}']);
    });

    it('handles characters split between chunks', async () => {
      const decoder = new UTF32Decoder(true);

      const input = [
        new Uint8Array([0x41]),
        new Uint8Array([0x00]),
        new Uint8Array([0x00, 0x00, 0x00, 0xf6]),
        new Uint8Array([0x01, 0x00]),
        new Uint8Array([0x01, 0xf6, 0x01]),
        new Uint8Array([0x00]),
      ];
      expect(await pipe(input, decoder)).equals(['A', '\u{1f600}', '\u{1f601}']);
    });
  });
});

async function pipe(input: (Buffer | Uint8Array)[], decoder: UTF32Decoder): Promise<string[]> {
  const output: string[] = [];
  for await (const chunk of ReadableStream.from(input).pipeThrough(decoder)) {
    output.push(chunk);
  }
  return output;
}
