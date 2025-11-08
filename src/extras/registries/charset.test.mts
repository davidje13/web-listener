import { ReadableStream, TextDecoderStream } from 'node:stream/web';
import {
  internalDecodeUnicode,
  getTextDecoderStream,
  registerCharset,
  registerUTF32,
  getTextDecoder,
} from './charset.mts';
import 'lean-test';

describe('getTextDecoder', () => {
  it('returns a text decoder for the requested encoding', () => {
    const input = new Uint8Array([0xb7, 0xb5]);
    const decoder = getTextDecoder('macintosh', {});
    expect(decoder.decode(input)).equals('∑µ');
  });

  it('supports custom registered character sets', () => {
    registerCharset('my-custom-charset', {
      decoder: (options) => new TextDecoder('iso-8859-2', options),
    });
    const input = new Uint8Array([0xa1, 0xfe]);

    const decoder = getTextDecoder('my-custom-charset', {});
    expect(decoder.decode(input)).equals('Ąţ');
  });

  it('throws for unknown character sets', async () => {
    expect(() => getTextDecoder('unknown-thing', {})).throws('unsupported charset: unknown-thing');
  });
});

describe('getTextDecoderStream', () => {
  it('returns a text decoder stream for the requested encoding', async () => {
    const input = new Uint8Array([0xb7, 0xb5]);
    const decoder = getTextDecoderStream('macintosh', {});
    expect(await read(stream([input]).pipeThrough(decoder))).equals(['∑µ']);
  });

  it('supports custom registered character sets', async () => {
    registerCharset('my-custom-charset', {
      decoder: (options) => new TextDecoder('iso-8859-2', options),
      decoderStream: (options) => new TextDecoderStream('iso-8859-2', options),
    });
    const input = new Uint8Array([0xa1, 0xfe]);

    const decoder = getTextDecoderStream('my-custom-charset', {});
    expect(await read(stream([input]).pipeThrough(decoder))).equals(['Ąţ']);
  });

  it('builds a decoder stream automatically if one was not registered', async () => {
    registerCharset('my-custom-charset', {
      decoder: (options) => new TextDecoder('iso-8859-2', options),
    });
    const input = new Uint8Array([0xa1, 0xfe]);

    const decoder = getTextDecoderStream('my-custom-charset', {});
    expect(await read(stream([input]).pipeThrough(decoder))).equals(['Ąţ']);
  });

  it('throws for unknown character sets', async () => {
    expect(() => getTextDecoderStream('unknown-thing', {})).throws(
      'unsupported charset: unknown-thing',
    );
  });
});

describe('internalUnicodeDecoderStream', () => {
  beforeAll(() => {
    registerUTF32();
  });

  describe('detects the unicode format of the input from the first few bytes', () => {
    it('decodes a string from a byte stream', async () => {
      const json = '{"foo":"bar"}';
      const { utf8, utf16le, utf16be, utf32le, utf32be } = makeEncodings(json);
      expect(await read(await internalDecodeUnicode(stream([utf8]), {}))).equals([json]);
      expect(await read(await internalDecodeUnicode(stream([utf16le]), {}))).equals([json]);
      expect(await read(await internalDecodeUnicode(stream([utf16be]), {}))).equals([json]);
      expect(await read(await internalDecodeUnicode(stream([utf32le]), {}))).equals([json]);
      expect(await read(await internalDecodeUnicode(stream([utf32be]), {}))).equals([json]);
    });

    it('works if the document is a string starting with a non-BMP character', async () => {
      const json = '"\u{1f601}"';
      const { utf8, utf16le, utf16be, utf32le, utf32be } = makeEncodings(json);
      expect(await read(await internalDecodeUnicode(stream([utf8]), {}))).equals([json]);
      expect(await read(await internalDecodeUnicode(stream([utf16le]), {}))).equals([json]);
      expect(await read(await internalDecodeUnicode(stream([utf16be]), {}))).equals([json]);
      expect(await read(await internalDecodeUnicode(stream([utf32le]), {}))).equals([json]);
      expect(await read(await internalDecodeUnicode(stream([utf32be]), {}))).equals([json]);
    });

    it('works if the document is short', async () => {
      const json = '[]';
      const { utf8, utf16le, utf16be, utf32le, utf32be } = makeEncodings(json);
      expect(await read(await internalDecodeUnicode(stream([utf8]), {}))).equals([json]);
      expect(await read(await internalDecodeUnicode(stream([utf16le]), {}))).equals([json]);
      expect(await read(await internalDecodeUnicode(stream([utf16be]), {}))).equals([json]);
      expect(await read(await internalDecodeUnicode(stream([utf32le]), {}))).equals([json]);
      expect(await read(await internalDecodeUnicode(stream([utf32be]), {}))).equals([json]);
    });

    it('works if the document is a single character', async () => {
      const json = '\n';
      const { utf8, utf16le, utf16be, utf32le, utf32be } = makeEncodings(json);
      expect(await read(await internalDecodeUnicode(stream([utf8]), {}))).equals([json]);
      expect(await read(await internalDecodeUnicode(stream([utf16le]), {}))).equals([json]);
      expect(await read(await internalDecodeUnicode(stream([utf16be]), {}))).equals([json]);
      expect(await read(await internalDecodeUnicode(stream([utf32le]), {}))).equals([json]);
      expect(await read(await internalDecodeUnicode(stream([utf32be]), {}))).equals([json]);
    });

    it('returns no data if the document is empty', async () => {
      const { utf8, utf16le, utf16be, utf32le, utf32be } = makeEncodings('');
      expect(await read(await internalDecodeUnicode(stream([utf8]), {}))).equals([]);
      expect(await read(await internalDecodeUnicode(stream([utf16le]), {}))).equals([]);
      expect(await read(await internalDecodeUnicode(stream([utf16be]), {}))).equals([]);
      expect(await read(await internalDecodeUnicode(stream([utf32le]), {}))).equals([]);
      expect(await read(await internalDecodeUnicode(stream([utf32be]), {}))).equals([]);
    });

    it('works with Buffer', async () => {
      const json = '{"foo":"bar"}';
      const { utf8 } = makeEncodings(json);
      expect(await read(await internalDecodeUnicode(stream([Buffer.from(utf8)]), {}))).equals([
        json,
      ]);
    });

    it('handles characters split between chunks', async () => {
      const { utf16le } = makeEncodings('{"foo":"bar"}');
      const fragmented = [
        utf16le.subarray(0, 1),
        utf16le.subarray(1, 2),
        utf16le.subarray(2, 4),
        utf16le.subarray(4, 9),
        utf16le.subarray(9),
      ];
      expect(await read(await internalDecodeUnicode(stream(fragmented), {}))).equals([
        '{',
        '"',
        'fo',
        'o":"bar"}',
      ]);
    });
  });
});

const stream = ReadableStream.from;

function makeEncodings(content: string) {
  const utf8 = new TextEncoder().encode(content);
  const utf16le = new Uint8Array(content.length * 2);
  const utf16be = new Uint8Array(content.length * 2);
  const utf16ledv = new DataView(utf16le.buffer, utf16le.byteOffset, utf16le.byteLength);
  const utf16bedv = new DataView(utf16be.buffer, utf16be.byteOffset, utf16be.byteLength);
  for (let i = 0; i < content.length; ++i) {
    const c = content.charCodeAt(i);
    utf16ledv.setUint16(i * 2, c, true);
    utf16bedv.setUint16(i * 2, c, false);
  }
  let n = 0;
  for (const _ of content) {
    ++n;
  }
  const utf32le = new Uint8Array(n * 4);
  const utf32be = new Uint8Array(n * 4);
  const utf32ledv = new DataView(utf32le.buffer, utf32le.byteOffset, utf32le.byteLength);
  const utf32bedv = new DataView(utf32be.buffer, utf32be.byteOffset, utf32be.byteLength);
  let p = 0;
  for (const char of content) {
    const c = char.codePointAt(0) ?? 0;
    utf32ledv.setUint32(p, c, true);
    utf32bedv.setUint32(p, c, false);
    p += 4;
  }
  return { utf8, utf16le, utf16be, utf32le, utf32be };
}

async function read(readable: ReadableStream<string>): Promise<string[]> {
  const output: string[] = [];
  for await (const chunk of readable) {
    output.push(chunk);
  }
  return output;
}
