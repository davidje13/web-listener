import { ReadableStream, TextDecoderStream, type TextDecoderOptions } from 'node:stream/web';
import { UTF32Decoder } from '../../util/UTF32Decoder.mts';
import { HTTPError } from '../../core/HTTPError.mts';
import {
  type Decoder,
  type DecoderStream,
  WrappedDecoderStream,
} from '../../util/DecoderStream.mts';

interface Charset {
  decoder: (options: TextDecoderOptions) => Decoder;
  decoderStream?: (options: TextDecoderOptions) => DecoderStream;
}

const CHARSETS = new Map<string, Charset>();

export function registerCharset(name: string, definition: Charset) {
  CHARSETS.set(name.toLowerCase(), definition);
}

export function registerUTF32() {
  registerCharset('utf-32be', { decoder: (options) => new UTF32Decoder(false, options) });
  registerCharset('utf-32le', { decoder: (options) => new UTF32Decoder(true, options) });
}

export function getTextDecoder(charsetName: string, options: TextDecoderOptions = {}): Decoder {
  const custom = CHARSETS.get(charsetName.toLowerCase());
  if (custom) {
    return custom.decoder(options);
  }
  try {
    return new TextDecoder(charsetName, options);
  } catch {
    throw new HTTPError(415, { body: `unsupported charset: ${charsetName}` });
  }
}

export function getTextDecoderStream(
  charsetName: string,
  options: TextDecoderOptions = {},
): DecoderStream {
  const custom = CHARSETS.get(charsetName.toLowerCase());
  if (custom) {
    if (custom.decoderStream) {
      return custom.decoderStream(options);
    } else {
      return new WrappedDecoderStream(custom.decoder(options));
    }
  }
  try {
    return new TextDecoderStream(charsetName, options);
  } catch {
    throw new HTTPError(415, { body: `unsupported charset: ${charsetName}` });
  }
}

export async function internalDecodeUnicode(
  readable: ReadableStream<Uint8Array>,
  options: TextDecoderOptions,
): Promise<ReadableStream<string>> {
  // This is specifically for detecting JSON encodings,
  // which can be identified from the first 3 bytes.
  // See https://www.ietf.org/rfc/rfc4627.txt

  const inReader = readable.getReader();
  const temp = new Uint8Array(3);
  let n = 0;
  let latestChunk: Uint8Array | null = null;
  while (true) {
    const next = await inReader.read();
    const begin = 3 - n;
    if (next.done) {
      if (n === 0) {
        temp[0] = 1;
        temp[1] = 1;
      } else if (n === 1) {
        temp[1] = temp[0]!;
      }
      temp[2] = temp[0]!;
      latestChunk = null;
      break;
    }
    latestChunk = next.value;
    if (latestChunk.byteLength >= begin) {
      temp.set(latestChunk.subarray(0, begin), n);
      break;
    }
    temp.set(latestChunk, n);
    n += latestChunk.byteLength;
  }

  const charset =
    UNICODE_PATTERNS[(temp[0] ? 0b100 : 0) | (temp[1] ? 0b010 : 0) | (temp[2] ? 0b001 : 0)];
  if (!charset) {
    inReader.cancel();
    throw new HTTPError(415, { body: 'invalid JSON encoding' });
  }
  const decoder = getTextDecoderStream(charset, options);
  const decoderWriter = decoder.writable.getWriter();
  if (n) {
    decoderWriter.write(temp.subarray(0, n));
  }
  if (latestChunk) {
    decoderWriter.write(latestChunk);
  }
  inReader.releaseLock();
  decoderWriter.releaseLock();
  return readable.pipeThrough(decoder);
}

// The first character of a JSON document MUST be a plain ASCII character [ \t\n{\["0-9\-ntf]
// The second character can be anything (if following a ")
// No characters can be \x00
const UNICODE_PATTERNS = [
  /* 00 00 00 */ 'utf-32be',
  /* 00 00 xx */ null,
  /* 00 xx 00 */ 'utf-16be',
  /* 00 xx xx */ 'utf-16be',
  /* xx 00 00 */ 'utf-32le',
  /* xx 00 xx */ 'utf-16le',
  /* xx xx 00 */ null,
  /* xx xx xx */ 'utf-8',
];
