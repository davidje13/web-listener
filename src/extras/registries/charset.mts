import {
  ReadableStream,
  TransformStream,
  TextDecoderStream,
  type TextDecoderOptions,
} from 'node:stream/web';
import { UTF32Decoder } from '../../util/UTF32Decoder.mts';
import { HTTPError } from '../../core/HTTPError.mts';

const CHARSETS = new Map<
  string,
  (options: TextDecoderOptions) => TransformStream<Uint8Array, string>
>();

export function registerCharset(
  charset: string,
  transformerFactory: (options: TextDecoderOptions) => TransformStream<Uint8Array, string>,
) {
  CHARSETS.set(charset.toLowerCase(), transformerFactory);
}

export function registerUTF32() {
  registerCharset('utf-32be', () => new UTF32Decoder(false));
  registerCharset('utf-32le', () => new UTF32Decoder(true));
}

export function internalTextDecoderStream(charset: string, options: TextDecoderOptions) {
  const custom = CHARSETS.get(charset);
  if (custom) {
    return custom(options);
  }
  try {
    return new TextDecoderStream(charset, options);
  } catch {
    throw new HTTPError(415, { body: `unsupported charset: ${charset}` });
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
  const decoder = internalTextDecoderStream(charset, options);
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
