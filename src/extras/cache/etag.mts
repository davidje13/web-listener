import { createReadStream, type Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { ReadOnlyFileHandle } from '../../util/ReadOnlyFileHandle.mts';
import { createSafeReadStream } from '../../util/createSafeReadStream.mts';
import type { LooseHeaderValue } from '../../util/normaliseHeaders.mts';

export function generateWeakETag(
  contentEncoding: LooseHeaderValue | undefined,
  fileStats: Pick<Stats, 'mtimeMs' | 'size'>,
) {
  const token = `${fileStats.mtimeMs | 0} ${fileStats.size} ${contentEncoding ?? ''}`;
  const hash = createHash('sha256').update(token).digest('base64').substring(0, 12);
  return `W/"${hash}"`;
}

export async function generateStrongETag(
  file: string | Pick<ReadOnlyFileHandle, 'createReadStream'>,
) {
  const hash = createHash('sha256');
  if (typeof file === 'string') {
    await pipeline(createReadStream(file), hash);
  } else {
    await pipeline(createSafeReadStream(file, { start: 0, autoClose: false }), hash);
  }
  return `"sha256-${hash.digest('base64')}"`;
}

export const generateStrongETagStatic = (content: Buffer) => {
  const hash = createHash('sha256');
  hash.write(content);
  return `"sha256-${hash.digest('base64')}"`;
};
