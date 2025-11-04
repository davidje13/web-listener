import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { basename, dirname, extname, join } from 'node:path';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { internalMutateName, type FileNegotiationOption } from '../request/negotiation.mts';
import { getMime } from '../registries/mime.mts';

export interface CompressionInfo {
  /** the path to the file */
  file: string;

  /** the mime type of the file */
  mime: string;

  /** the size of the original file in bytes */
  rawSize: number;

  /** the size of the smallest compressed version of the file in bytes */
  bestSize: number;

  /** the number of compressed files which were saved */
  created: number;
}

export async function compressFileOffline(
  file: string,
  options: FileNegotiationOption[],
  minCompress: number,
): Promise<CompressionInfo> {
  const raw = await readFile(file);
  const info = {
    file,
    mime: getMime(extname(file)),
    rawSize: raw.byteLength,
    bestSize: raw.byteLength,
    created: 0,
  };

  if (info.rawSize <= minCompress) {
    return info;
  }

  if (['image', 'video', 'audio', 'font'].includes(info.mime.split('/')[0]!)) {
    // ignore formats which usually apply their own compression
    return info;
  }

  for (const opt of options) {
    const compress = ENCODERS.get(opt.match as string);
    const mutated = join(dirname(file), internalMutateName(basename(file), opt.file));
    if (!compress || mutated === opt.file) {
      continue;
    }
    const compressed = await compress(raw);
    if (compressed.byteLength <= info.rawSize - minCompress) {
      await writeFile(mutated, compressed);
      info.bestSize = Math.min(info.bestSize, compressed.byteLength);
      ++info.created;
    }
  }

  return info;
}

export async function compressFilesInDir(
  dir: string,
  options: FileNegotiationOption[],
  minCompress: number,
): Promise<CompressionInfo[]> {
  const allFiles: string[] = [];
  await findFilesR(dir, allFiles);
  const files = new Set(allFiles);
  // remove existing compressed files from the set
  for (const file of files) {
    for (const opt of options) {
      const mutated = join(dirname(file), internalMutateName(basename(file), opt.file));
      if (mutated !== file) {
        files.delete(mutated);
      }
    }
  }
  return Promise.all([...files].map((file) => compressFileOffline(file, options, minCompress)));
}

async function findFilesR(dir: string, output: string[]) {
  const s = await stat(dir);
  if (s.isDirectory()) {
    for (const file of await readdir(dir)) {
      await findFilesR(join(dir, file), output);
    }
  } else if (s.isFile()) {
    output.push(dir);
  }
}

const ENCODERS = /*@__PURE__*/ new Map<string, (buffer: Buffer) => Promise<Buffer>>([
  ['zstd', (buffer) => promisify(zlib.zstdCompress)(buffer)],
  [
    'brotli',
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
