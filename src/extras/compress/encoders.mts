import {
  constants,
  createBrotliCompress,
  createDeflate,
  createGzip,
  createZstdCompress,
} from 'node:zlib';
import { Readable, type Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { buffer } from 'node:stream/consumers';

export type ContentEncoding = 'zstd' | 'br' | 'gzip' | 'deflate' | 'identity';
export type EncodingQuality = 'fast' | 'default' | 'max';

const ENCODERS = /*@__PURE__*/ new Map<
  ContentEncoding,
  (quality: QualityConstants, size: number | undefined) => Transform
>([
  [
    'zstd',
    (quality) =>
      createZstdCompress({ params: { [constants.ZSTD_c_compressionLevel]: quality.zs } }),
  ],
  [
    'br',
    (quality, size) =>
      createBrotliCompress({
        params: {
          [constants.BROTLI_PARAM_QUALITY]: quality.br,
          [constants.BROTLI_PARAM_SIZE_HINT]: size ?? 0,
        },
      }),
  ],
  ['gzip', (quality) => createGzip({ level: quality.z })],
  ['deflate', (quality) => createDeflate({ level: quality.z })],
]);

interface QualityConstants {
  z: number;
  br: number;
  zs: number;
}

export const internalCompressor = (
  encoding: ContentEncoding,
  quality: EncodingQuality,
  sizeGuess?: number | undefined,
) => {
  const enc = ENCODERS.get(encoding);
  if (!enc) {
    return undefined;
  }

  const QUALITY = new Map<EncodingQuality, QualityConstants>([
    ['fast', { z: constants.Z_BEST_SPEED, br: constants.BROTLI_MIN_QUALITY, zs: 2 }],
    ['max', { z: constants.Z_BEST_COMPRESSION, br: constants.BROTLI_MAX_QUALITY, zs: 9 }],
  ]);

  return enc(
    QUALITY.get(quality) ?? {
      z: constants.Z_DEFAULT_COMPRESSION,
      br: constants.BROTLI_DEFAULT_QUALITY,
      zs: constants.ZSTD_CLEVEL_DEFAULT,
    },
    sizeGuess,
  );
};

export async function internalCompressBuffer(
  content: Buffer,
  encoding: ContentEncoding,
  quality: EncodingQuality,
  minCompression: number,
): Promise<Buffer | undefined> {
  const threshold = content.byteLength - minCompression;
  if (threshold <= 0) {
    return undefined;
  }
  const compressor = internalCompressor(encoding, quality, content.byteLength);
  if (!compressor) {
    return undefined;
  }
  const compressed = await pipeline(Readable.from(content), compressor, buffer);
  return compressed.byteLength <= threshold ? compressed : undefined;
}
