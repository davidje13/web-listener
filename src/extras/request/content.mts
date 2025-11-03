import type { IncomingMessage } from 'node:http';
import { Duplex, Readable } from 'node:stream';
import {
  TransformStream,
  DecompressionStream,
  type ReadableStream,
  type TextDecoderOptions,
} from 'node:stream/web';
import { createBrotliDecompress, createZstdDecompress } from 'node:zlib';
import { HTTPError } from '../../core/HTTPError.mts';
import { ByteLimitStream } from '../../util/ByteLimitStream.mts';
import { internalDecodeUnicode, internalTextDecoderStream } from '../registries/charset.mts';
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
  return readable.pipeThrough(internalTextDecoderStream(charset, options));
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
  switch (id.toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return new DecompressionStream('gzip');
    case 'deflate':
      return new DecompressionStream('deflate');
    case 'br':
      try {
        return new DecompressionStream('brotli' as any); // Node 24+
      } catch {
        return Duplex.toWeb(createBrotliDecompress());
      }
    case 'zstd':
      return Duplex.toWeb(createZstdDecompress());
    default:
      throw new HTTPError(415, { body: 'unknown content encoding' });
  }
}
