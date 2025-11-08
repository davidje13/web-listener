import { ReadableStream } from 'node:stream/web';
import { WrappedDecoderStream, type DecoderStream } from './DecoderStream.mts';
import { UTF32Decoder } from './UTF32Decoder.mts';
import 'lean-test';

describe('UTF32Decoder', () => {
  describe('big endian utf-32-be', () => {
    it('decodes a string from bytes', () => {
      const d = new UTF32Decoder(false);

      const input = new Uint8Array([
        0x00, 0x00, 0x00, 0x41, 0x00, 0x01, 0xf6, 0x00, 0x00, 0x01, 0xf6, 0x01,
      ]);
      expect(d.decode(input)).equals('A\u{1f600}\u{1f601}');
    });

    it('works with Buffer', () => {
      const d = new UTF32Decoder(false);

      const input = Buffer.from([
        0x00, 0x00, 0x00, 0x41, 0x00, 0x01, 0xf6, 0x00, 0x00, 0x01, 0xf6, 0x01,
      ]);
      expect(d.decode(input)).equals('A\u{1f600}\u{1f601}');
    });

    it('returns an empty string for no input', async () => {
      const d = new UTF32Decoder(false);
      expect(d.decode(new Uint8Array([]))).equals('');
    });

    it('replaces partial input with a substitution character', async () => {
      const d = new UTF32Decoder(false);
      expect(d.decode(new Uint8Array([0x00, 0x00, 0x00, 0x41, 0x00]))).equals('A\uFFFD');
    });

    it('rejects partial input if fatal is true', async () => {
      const d = new UTF32Decoder(false, { fatal: true });
      expect(() => d.decode(new Uint8Array([0x00, 0x00, 0x01]))).throws(
        'invalid byte length for utf-32 content',
      );
    });

    it('handles characters split between chunks when stream is true', async () => {
      const d = new UTF32Decoder(false);

      expect(d.decode(new Uint8Array([0x00]), { stream: true })).equals('');
      expect(d.decode(new Uint8Array([0x00]), { stream: true })).equals('');
      expect(d.decode(new Uint8Array([0x00, 0x41, 0x00, 0x01]), { stream: true })).equals('A');
      expect(d.decode(new Uint8Array([0xf6, 0x00]), { stream: true })).equals('\u{1f600}');
      expect(d.decode(new Uint8Array([0x00, 0x01, 0xf6]), { stream: true })).equals('');
      expect(d.decode(new Uint8Array([0x01]), { stream: false })).equals('\u{1f601}');
    });
  });

  describe('little endian utf-32-le', () => {
    it('decodes a string from bytes', async () => {
      const d = new UTF32Decoder(true);

      const input = new Uint8Array([0x41, 0x00, 0x00, 0x00, 0x00, 0xf6, 0x01, 0x00]);
      expect(d.decode(input)).equals('A\u{1f600}');
    });

    it('returns an empty string for no input', async () => {
      const d = new UTF32Decoder(true);
      expect(d.decode(new Uint8Array([]))).equals('');
    });

    it('replaces partial input with a substitution character', async () => {
      const d = new UTF32Decoder(true);
      expect(d.decode(new Uint8Array([0x41, 0x00, 0x00, 0x00, 0x00]))).equals('A\uFFFD');
    });

    it('rejects partial input if fatal is true', async () => {
      const d = new UTF32Decoder(true, { fatal: true });
      expect(() => d.decode(new Uint8Array([0x41, 0x00, 0x00]))).throws(
        'invalid byte length for utf-32 content',
      );
    });

    it('handles characters split between chunks when stream is true', async () => {
      const d = new UTF32Decoder(true);

      expect(d.decode(new Uint8Array([0x41]), { stream: true })).equals('');
      expect(d.decode(new Uint8Array([0x00]), { stream: true })).equals('');
      expect(d.decode(new Uint8Array([0x00, 0x00, 0x00, 0xf6]), { stream: true })).equals('A');
      expect(d.decode(new Uint8Array([0x01, 0x00]), { stream: true })).equals('\u{1f600}');
      expect(d.decode(new Uint8Array([0x01, 0xf6, 0x01]), { stream: true })).equals('');
      expect(d.decode(new Uint8Array([0x00]), { stream: false })).equals('\u{1f601}');
    });
  });
});

describe('UTF32DecoderStream', () => {
  describe('big endian utf-32-be', () => {
    it('decodes a string from a byte stream', async () => {
      const decoder = new WrappedDecoderStream(new UTF32Decoder(false));

      const input = [
        new Uint8Array([0x00, 0x00, 0x00, 0x41, 0x00, 0x01, 0xf6, 0x00, 0x00, 0x01, 0xf6, 0x01]),
      ];
      expect(await pipe(input, decoder)).equals(['A\u{1f600}\u{1f601}']);
    });

    it('works with Buffer', async () => {
      const decoder = new WrappedDecoderStream(new UTF32Decoder(false));

      const input = [
        Buffer.from([0x00, 0x00, 0x00, 0x41, 0x00, 0x01, 0xf6, 0x00, 0x00, 0x01, 0xf6, 0x01]),
      ];
      expect(await pipe(input, decoder)).equals(['A\u{1f600}\u{1f601}']);
    });

    it('handles characters split between chunks', async () => {
      const decoder = new WrappedDecoderStream(new UTF32Decoder(false));

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
      const decoder = new WrappedDecoderStream(new UTF32Decoder(true));

      const input = [new Uint8Array([0x41, 0x00, 0x00, 0x00, 0x00, 0xf6, 0x01, 0x00])];
      expect(await pipe(input, decoder)).equals(['A\u{1f600}']);
    });

    it('handles characters split between chunks', async () => {
      const decoder = new WrappedDecoderStream(new UTF32Decoder(true));

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

async function pipe(input: (Buffer | Uint8Array)[], decoder: DecoderStream): Promise<string[]> {
  const output: string[] = [];
  for await (const chunk of ReadableStream.from(input).pipeThrough(decoder)) {
    output.push(chunk);
  }
  return output;
}
