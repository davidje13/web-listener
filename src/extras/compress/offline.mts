import { basename, dirname, extname, join } from 'node:path';
import { readFile, writeFile, rm, utimes, stat } from 'node:fs/promises';
import { internalMutateName, type FileNegotiationOption } from '../request/Negotiator.mts';
import { getMime } from '../registries/mime.mts';
import { internalCompressBuffer, type ContentEncoding } from './encoders.mts';
import { FileFinderRules, type FileFinderOptions } from '../filesystem/FileFinder.mts';
import { internalDiscoverFiles } from '../filesystem/staticFileFinder.mts';

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

export interface CompressionOptions {
  /**
   * the minimum compression (in bytes) which must be achieved to save the file
   * @default 0
   */
  minCompression?: number | undefined;

  /**
   * if `true`, existing compressed files which are no-longer relevant will be removed
   * @default false
   */
  deleteObsolete?: boolean | undefined;

  /**
   * if `true`, the modified time of the compressed files will be set to match the modified time of
   * the input file
   * @default true
   */
  matchModifiedTime?: boolean | undefined;

  /**
   * Filter to apply to files (does not attempt to compress files if the function returns `false`)
   * @param path the full path to the file
   * @param mime the mime type of the file (if known, else 'application/binary')
   * @returns `true` if the file should be compressed
   * @default (_, mime) => !['image', 'video', 'audio', 'font'].includes(mime.split('/')[0])
   */
  filter?: ((path: string, mime: string) => boolean) | undefined;
}

const DEFAULT_FILTER = (_: string, mime: string) =>
  !['image', 'video', 'audio', 'font'].includes(mime.split('/')[0]!);

export async function compressFileOffline(
  file: string,
  encodings: ReadonlyArray<FileNegotiationOption>,
  {
    minCompression = 0,
    deleteObsolete = false,
    matchModifiedTime = true,
    filter = DEFAULT_FILTER,
  }: CompressionOptions = {},
): Promise<CompressionInfo> {
  const raw = await readFile(file);
  const info = {
    file,
    mime: getMime(extname(file)),
    rawSize: raw.byteLength,
    bestSize: raw.byteLength,
    created: 0,
  };

  if (!filter(file, info.mime)) {
    // ignore formats which usually apply their own compression
    return info;
  }

  const fileStats = await stat(file);
  for (const opt of encodings) {
    const mutated = join(dirname(file), internalMutateName(basename(file), opt.file));
    if (mutated === opt.file) {
      continue;
    }
    const compressed = await internalCompressBuffer(
      raw,
      opt.value as ContentEncoding,
      'max',
      minCompression,
    );
    if (compressed) {
      await writeFile(mutated, compressed);
      if (matchModifiedTime) {
        await utimes(mutated, fileStats.atime, fileStats.mtime);
      }
      info.bestSize = Math.min(info.bestSize, compressed.byteLength);
      ++info.created;
    } else if (deleteObsolete) {
      await rm(mutated).catch(() => {});
    }
  }

  return info;
}

export async function compressFilesInDir(
  dir: string,
  encodings: ReadonlyArray<FileNegotiationOption>,
  options: CompressionOptions &
    Pick<
      FileFinderOptions,
      'subDirectories' | 'allowAllDotfiles' | 'allowAllTildefiles' | 'hide' | 'allow'
    > = {},
): Promise<CompressionInfo[]> {
  const rules = new FileFinderRules(options);
  const files = new Set<string>();
  await internalDiscoverFiles(dir, rules, (path, name) => files.add(join(dir, ...path, name)));

  // remove existing compressed files from the set
  for (const file of files) {
    for (const opt of encodings) {
      const mutated = join(dirname(file), internalMutateName(basename(file), opt.file));
      if (mutated !== file) {
        files.delete(mutated);
      }
    }
  }
  return Promise.all([...files].map((file) => compressFileOffline(file, encodings, options)));
}
