import zlib from 'node:zlib';
import { promisify } from 'node:util';

export type ContentEncoding = 'zstd' | 'br' | 'gzip' | 'deflate';

const ENCODERS = /*@__PURE__*/ new Map<string, (buffer: Buffer) => Promise<Buffer>>([
  ['zstd', (buffer) => promisify(zlib.zstdCompress)(buffer)],
  [
    'br',
    (buffer) =>
      promisify(zlib.brotliCompress)(buffer, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: zlib.constants.BROTLI_MAX_QUALITY,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.length,
        },
      }),
  ],
  ['gzip', (buffer) => promisify(zlib.gzip)(buffer, { level: zlib.constants.Z_BEST_COMPRESSION })],
  ['deflate', (buffer) => promisify(zlib.deflate)(buffer)],
]);

export async function compress(
  content: Buffer,
  encoding: string,
  minCompression: number,
): Promise<Buffer | undefined> {
  const threshold = content.byteLength - minCompression;
  if (threshold <= 0) {
    return undefined;
  }
  const encoder = ENCODERS.get(encoding);
  if (!encoder) {
    return undefined;
  }
  const compressed = await encoder(content);
  return compressed.byteLength <= threshold ? compressed : undefined;
}
