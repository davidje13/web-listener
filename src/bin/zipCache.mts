import { join, sep } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { text } from 'node:stream/consumers';
import { readZip, type ZipDirectory, type ZipNode } from '../index.mts';
import { UserError } from './UserError.mts';

const CACHED_ZIPS: { path: string; root: ZipDirectory }[] = [];

function findCached(
  path: string,
): { path: string; root: ZipDirectory; remaining: string[] } | undefined {
  for (const cache of CACHED_ZIPS) {
    if (path.startsWith(cache.path)) {
      if (path.length === cache.path.length || path[cache.path.length] === sep) {
        const remaining = path.substring(cache.path.length + 1);
        return { ...cache, remaining: remaining ? remaining.split(sep) : [] };
      }
    }
  }
  return undefined;
}

export async function readZipPath(
  path: string,
  skipIfValidFile: boolean,
): Promise<{ path: string; root: ZipDirectory; remaining: string[] } | undefined> {
  const cached = findCached(path);
  if (cached) {
    return cached;
  }
  const parts = path.split(sep);
  if (parts[parts.length - 1] === '') {
    parts.pop();
  }
  if (!parts[0]) {
    parts.shift();
    if (parts.length > 0) {
      parts[0] = sep + parts[0];
    }
  }
  for (let i = parts.length; i > 0; --i) {
    const filePath = join(...parts.slice(0, i));
    const stats = await stat(filePath).catch(() => null);
    if (!stats) {
      continue;
    }
    if (!stats.isFile()) {
      break;
    }
    if (skipIfValidFile && i === parts.length) {
      return undefined;
    }
    const zip = { path: filePath, root: await readZip(filePath) };
    CACHED_ZIPS.push(zip);
    return { ...zip, remaining: parts.slice(i) };
  }
  return undefined;
}

export async function readAnyFile(path: string): Promise<string> {
  const zip = await readZipPath(path, true);
  if (zip) {
    const zipNode = zip.root.find(zip.remaining);
    if (zipNode && !zipNode.isDirectory) {
      const handle = await zipNode.open();
      try {
        return await text(handle.createReadStream());
      } finally {
        await handle.close();
      }
    } else {
      throw new UserError(`/${zip.remaining.join('/')} not found in ${zip.path}`);
    }
  }
  return readFile(path, 'utf-8');
}

export function findZipPath(path: string): ZipNode | undefined {
  const cached = findCached(path);
  return cached?.root.find(cached.remaining);
}

export function clearZipCache() {
  CACHED_ZIPS.length = 0;
}
