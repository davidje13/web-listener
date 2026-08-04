import { join, sep } from 'node:path';
import { open, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { readZip, type ZipDirectory, type ZipNode } from './readZip.mts';
import type { ReadOnlyFileHandle } from '../../util/ReadOnlyFileHandle.mts';

export class AssetOpener {
  /** @internal */ declare private readonly _zipCache: { path: string; root: ZipDirectory }[];

  constructor() {
    this._zipCache = [];
  }

  async open(path: string): Promise<ReadOnlyFileHandle> {
    const zip = await this._readZipPath(path, true);
    if (!zip) {
      return open(path, constants.O_RDONLY);
    }
    const zipNode = zip.root.find(zip.remaining);
    if (!zipNode || zipNode.isDirectory) {
      throw new Error(`/${zip.remaining.join('/')} not found in ${zip.path}`);
    }
    return zipNode.open();
  }

  async findZipNode(path: string): Promise<ZipNode | undefined> {
    const zip = await this._readZipPath(path, false);
    return zip?.root.find(zip.remaining);
  }

  async preloadMetadata(path: string) {
    await this._readZipPath(path, true);
  }

  findCachedZipNodeSync(path: string): ZipNode | undefined {
    const cached = this._findCached(path);
    return cached?.root.find(cached.remaining);
  }

  clearMetadataCache() {
    this._zipCache.length = 0;
  }

  /** @internal */ private async _readZipPath(
    path: string,
    skipIfValidFile: boolean,
  ): Promise<{ path: string; root: ZipDirectory; remaining: string[] } | undefined> {
    const cached = this._findCached(path);
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
      this._zipCache.push(zip);
      return { ...zip, remaining: parts.slice(i) };
    }
    return undefined;
  }

  /** @internal */ private _findCached(
    path: string,
  ): { path: string; root: ZipDirectory; remaining: string[] } | undefined {
    for (const cache of this._zipCache) {
      if (path.startsWith(cache.path)) {
        if (path.length === cache.path.length || path[cache.path.length] === sep) {
          const remaining = path.substring(cache.path.length + 1);
          return { ...cache, remaining: remaining ? remaining.split(sep) : [] };
        }
      }
    }
    return undefined;
  }
}

export const SHARED_ASSET_OPENER = /*@__PURE__*/ new AssetOpener();
