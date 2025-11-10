import type { IncomingMessage } from 'node:http';
import { Duplex, Readable } from 'node:stream';
import {
  TransformStream,
  DecompressionStream,
  type ReadableStream,
  type TextDecoderOptions,
  type CompressionFormat,
} from 'node:stream/web';
import zlib from 'node:zlib';
import { HTTPError } from '../../core/HTTPError.mts';
import { ByteLimitStream } from '../../util/ByteLimitStream.mts';
import { internalDecodeUnicode, getTextDecoderStream } from '../registries/charset.mts';
import { getCharset, readHTTPInteger, readHTTPUnquotedCommaSeparated } from './headers.mts';
import { acceptBody } from './continue.mts';

interface GetBodyOptions {
  maxExpandedLength?: number;
  maxContentLength?: number;
  maxEncodingSteps?: number;
}

interface GetBodyTextOptions extends GetBodyOptions, TextDecoderOptions {
  defaultCharset?: string;
}

interface GetBodyJsonOptions extends GetBodyOptions, TextDecoderOptions {}

export function getBodyStream(
  req: IncomingMessage,
  {
    maxExpandedLength = Number.POSITIVE_INFINITY,
    maxContentLength = maxExpandedLength,
    maxEncodingSteps = 1,
  }: GetBodyOptions = {},
): ReadableStream<Uint8Array> {
  // Node.js ensures we have EITHER content-length OR chunked content, so it is not possible
  // for the body to contain more data than the content-length header claims, if it is present.
  const contentLength = readHTTPInteger(req.headers['content-length']);
  if (contentLength !== undefined && contentLength > maxContentLength) {
    throw new HTTPError(413);
  }
  const encodings = readHTTPUnquotedCommaSeparated(req.headers['content-encoding']) ?? [];
  if (encodings.length > maxEncodingSteps) {
    throw new HTTPError(415, { body: 'too many content-encoding stages' });
  }
  acceptBody(req);
  let readable: ReadableStream<Uint8Array> = Readable.toWeb(req);
  if (contentLength === undefined && Number.isFinite(maxContentLength)) {
    readable = readable.pipeThrough(new ByteLimitStream(maxContentLength, new HTTPError(413)));
  }
  for (const encoding of encodings.reverse()) {
    readable = readable.pipeThrough(internalGetDecoder(encoding));
  }
  if (Number.isFinite(maxExpandedLength)) {
    readable = readable.pipeThrough(
      new ByteLimitStream(
        maxExpandedLength,
        new HTTPError(413, { body: 'decoded content too large' }),
      ),
    );
  }
  return readable;
}

export function getBodyTextStream(
  req: IncomingMessage,
  options: GetBodyTextOptions = {},
): ReadableStream<string> {
  const readable = getBodyStream(req, options);
  const charset = getCharset(req) ?? options.defaultCharset ?? 'utf-8';
  return readable.pipeThrough(getTextDecoderStream(charset, options));
}

export async function getBodyText(req: IncomingMessage, options: GetBodyTextOptions = {}) {
  const parts = [];
  for await (const part of getBodyTextStream(req, options)) {
    parts.push(part);
  }
  return parts.join('');
}

export async function getBodyJson(
  req: IncomingMessage,
  options: GetBodyJsonOptions = {},
): Promise<unknown> {
  const readable = await internalDecodeUnicode(getBodyStream(req, options), options);
  const parts = [];
  for await (const part of readable) {
    parts.push(part);
  }
  return JSON.parse(parts.join(''));
}

function internalGetDecoder(id: string): TransformStream<Uint8Array, Uint8Array> {
  // https://www.iana.org/assignments/http-parameters/http-parameters.xml

  // Note: once upon a time, using zlib without limiting the concurrency led to memory
  // fragmentation issues in Node.js.
  // Testing in 2025 shows that this is no longer the case, and it is safe to create as
  // many of these as we need to meet demand.
  // See https://github.com/nodejs/node/issues/8871#issuecomment-3493763033
  switch (id.toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return new DecompressionStream('gzip');
    case 'deflate':
      return new DecompressionStream('deflate');
    case 'br':
      try {
        return new DecompressionStream('brotli' as CompressionFormat); // Node 24+
      } catch {
        return Duplex.toWeb(zlib.createBrotliDecompress());
      }
    case 'zstd':
      try {
        return Duplex.toWeb(zlib.createZstdDecompress()); // Node 22.15+
      } catch {
        throw new HTTPError(415, { body: 'unsupported content encoding' });
      }
    default:
      throw new HTTPError(415, { body: 'unknown content encoding' });
  }
}
