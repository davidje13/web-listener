import { decompressMime, readMimeTypes, registerMime, resetMime } from '../index.mts';
import { isArray } from './util/isArray.mts';
import type { ConfigMime } from './config/types.mts';
import { readAnyFile } from './zipCache.mts';

export async function loadMime(mime: ConfigMime | ConfigMime[]) {
  const newMimes: Map<string, string>[] = [];
  for (const item of isArray(mime) ? mime : [mime]) {
    if (typeof item !== 'string') {
      newMimes.push(new Map(Object.entries(item)));
    } else if (item.startsWith('file://')) {
      newMimes.push(readMimeTypes(await readAnyFile(item.substring(7))));
    } else {
      newMimes.push(decompressMime(item));
    }
  }
  resetMime();
  for (const item of newMimes) {
    registerMime(item);
  }
}
