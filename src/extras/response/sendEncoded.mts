import type { ServerResponse, IncomingMessage } from 'node:http';
import { Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { internalIsPrematureCloseError } from '../../util/isPrematureCloseError.mts';
import { STOP } from '../../core/RoutingInstruction.mts';
import { negotiateEncoding, Negotiator } from '../request/Negotiator.mts';
import {
  internalCompressor,
  type ContentEncoding,
  type EncodingQuality,
} from '../compress/encoders.mts';
import { internalAddVary, internalSetContentEncoding } from './setHeaders.mts';

const ENCODINGS = ['zstd', 'br', 'gzip', 'deflate'] as const;
const DYNAMIC_NEGOTIATOR = /*@__PURE__*/ new Negotiator([
  /*@__PURE__*/ negotiateEncoding(ENCODINGS),
]);

export interface EncoderOptions {
  encodings?: ReadonlyArray<ContentEncoding> | undefined;
  encodingQuality?: EncodingQuality | undefined;
  estimatedLength?: number | undefined;
  compressionSizeThreshold?: number | undefined;
}

export function makeResponseEncoder(
  req: IncomingMessage,
  res: ServerResponse,
  {
    encodings = ENCODINGS,
    encodingQuality = 'fast',
    estimatedLength,
    compressionSizeThreshold = 0,
  }: EncoderOptions = {},
): Writable {
  if (estimatedLength === undefined || estimatedLength >= compressionSizeThreshold) {
    for (const { headers } of DYNAMIC_NEGOTIATOR.options('', req.headers)) {
      const enc = headers['content-encoding'] as ContentEncoding;
      if (!encodings.includes(enc)) {
        continue;
      }
      const compressor = internalCompressor(enc, encodingQuality, estimatedLength);
      if (compressor) {
        internalSetContentEncoding(res, enc);
        internalAddVary(res, headers.vary);
        compressor.pipe(res);
        return compressor;
      }
    }
    internalAddVary(res, 'accept');
  }
  return res;
}

export function sendEncoded(
  req: IncomingMessage,
  res: ServerResponse,
  content: string,
  options?: (EncoderOptions & { encoding?: BufferEncoding | undefined }) | undefined,
): Promise<void>;

export function sendEncoded(
  req: IncomingMessage,
  res: ServerResponse,
  content: ArrayBufferView | Readable | ReadableStream<Uint8Array>,
  options?: EncoderOptions | undefined,
): Promise<void>;

export async function sendEncoded(
  req: IncomingMessage,
  res: ServerResponse,
  content: string | ArrayBufferView | Readable | ReadableStream<Uint8Array>,
  {
    encoding = 'utf-8',
    ...options
  }: EncoderOptions & { encoding?: BufferEncoding | undefined } = {},
): Promise<void> {
  if (typeof content === 'string') {
    content = Buffer.from(content, encoding);
  }
  let length: number | undefined;
  if ('byteLength' in content) {
    length = content.byteLength;
    content = Readable.from(
      content instanceof Uint8Array
        ? content
        : new Uint8Array(content.buffer, content.byteOffset, content.byteLength),
    );
  }
  const writer = makeResponseEncoder(req, res, {
    ...options,
    estimatedLength: length ?? options.estimatedLength,
  });
  if (!res.hasHeader('content-encoding') && length !== undefined) {
    res.setHeader('content-length', length);
  }

  if (res.closed || !res.writable) {
    throw STOP;
  }
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  try {
    await pipeline(content, writer);
  } catch (error: unknown) {
    throw internalIsPrematureCloseError(res, error) ? STOP : error;
  }
}
