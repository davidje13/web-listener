import type { ServerResponse, IncomingMessage } from 'node:http';
import { Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { internalIsPrematureCloseError } from '../../util/isPrematureCloseError.mts';
import { internalDrainUncorked } from '../../util/drain.mts';
import { VOID_BUFFER } from '../../util/voidBuffer.mts';
import { STOP } from '../../core/RoutingInstruction.mts';
import { negotiateEncoding, Negotiator } from '../request/Negotiator.mts';
import {
  internalCompressor,
  type ContentEncoding,
  type EncodingQuality,
} from '../compress/encoders.mts';
import { internalAddVary, internalSetContentEncoding } from './setHeaders.mts';

const ENCODINGS = ['zstd', 'br', 'gzip'] as const;
const DYNAMIC_NEGOTIATOR = /*@__PURE__*/ new Negotiator([
  /*@__PURE__*/ negotiateEncoding(['zstd', 'br', 'gzip', 'deflate']),
]);

export interface EncoderOptions {
  /**
   * Set of encodings to support.
   * Only encodings which the current client accepts will be used.
   * @default ['zstd', 'br', 'gzip']
   */
  encodings?: ReadonlyArray<ContentEncoding> | undefined;
  /**
   * Guide for compression vs. speed trade-off.
   * @default 'fast'
   */
  encodingQuality?: EncodingQuality | undefined;
  /**
   * Estimated content size.
   * Used to decide whether to perform compression, and to adjust some compression options.
   * Does not need to be an accurate estimate.
   */
  estimatedLength?: number | undefined;
  /**
   * Minimum content size to attempt compression.
   * Ignored if the content size cannot be determined upfront and `estimatedLength` is not set.
   * @default 0
   */
  compressionSizeThreshold?: number | undefined;
}

export function makeResponseEncoder(
  req: Pick<IncomingMessage, 'headers'>,
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
        // destroy the response if there is an error, but do not propagate the error to it
        // (else we will observe it twice; once from the pipeline, and once in clientError)
        compressor.on('error', () => res.destroy());
        compressor.pipe(res);
        return compressor;
      }
    }
    internalAddVary(res, 'accept');
  }
  return res;
}

export function sendEncoded(
  req: Pick<IncomingMessage, 'method' | 'headers'>,
  res: ServerResponse,
  content: string | Generator<string | ArrayBufferView> | AsyncGenerator<string | ArrayBufferView>,
  options?: (EncoderOptions & { encoding?: BufferEncoding | undefined }) | undefined,
): Promise<void>;

export function sendEncoded(
  req: Pick<IncomingMessage, 'method' | 'headers'>,
  res: ServerResponse,
  content:
    | ArrayBufferView
    | Readable
    | ReadableStream<Uint8Array>
    | Generator<ArrayBufferView>
    | AsyncGenerator<ArrayBufferView>,
  options?: EncoderOptions | undefined,
): Promise<void>;

export async function sendEncoded(
  req: Pick<IncomingMessage, 'method' | 'headers'>,
  res: ServerResponse,
  content:
    | string
    | ArrayBufferView
    | Readable
    | ReadableStream<Uint8Array>
    | Generator<string | ArrayBufferView>
    | AsyncGenerator<string | ArrayBufferView>,
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
  if (content instanceof Readable || 'getReader' in content) {
    try {
      await pipeline(content, writer);
    } catch (error: unknown) {
      throw internalIsPrematureCloseError(res, error) ? STOP : error;
    }
  } else {
    try {
      if (writer === res) {
        // flush headers before we try streaming the content
        // (else the first value will be in its own chunk, despite using cork())
        writer.write(VOID_BUFFER);
      }
      writer.cork();
      if (Symbol.iterator in content) {
        for (const chunk of content) {
          if (!writer.write(chunk, encoding)) {
            await internalDrainUncorked(writer);
          }
        }
      } else {
        for await (const chunk of content) {
          if (!writer.write(chunk, encoding)) {
            await internalDrainUncorked(writer);
          }
        }
      }
      writer.uncork();
      writer.end();
    } catch (error: unknown) {
      if (writer.writable) {
        writer.destroy(error instanceof Error ? error : new Error(String(error)));
      }
      throw internalIsPrematureCloseError(res, error) ? STOP : error;
    }
  }
}
