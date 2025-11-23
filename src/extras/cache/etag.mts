import { createReadStream, type Stats } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

export function generateWeakETag(
  contentEncoding: string | number | string[] | undefined,
  fileStats: Pick<Stats, 'mtimeMs' | 'size'>,
) {
  const token = `${fileStats.mtimeMs | 0} ${fileStats.size} ${contentEncoding ?? ''}`;
  const hash = createHash('sha256').update(token).digest('base64').substring(0, 12);
  return `W/"${hash}"`;
}

export async function generateStrongETag(file: string | FileHandle) {
  const hash = createHash('sha256');
  if (typeof file === 'string') {
    await pipeline(createReadStream(file), hash);
  } else {
    await pipeline(file.createReadStream({ start: 0, autoClose: false }), hash);
  }
  return `"sha256-${hash.digest('base64')}"`;
}
