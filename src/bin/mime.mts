import { readFile } from 'node:fs/promises';
import { decompressMime, readMimeTypes, registerMime, resetMime } from '../index.mts';
import type { ConfigMime } from './config/types.mts';

export async function loadMime(mime: ConfigMime | ConfigMime[]) {
  const newMimes: Map<string, string>[] = [];
  for (const item of Array.isArray(mime) ? mime : [mime]) {
    if (typeof item !== 'string') {
      newMimes.push(new Map(Object.entries(item)));
    } else if (item.startsWith('file://')) {
      newMimes.push(readMimeTypes(await readFile(item.substring(7), 'utf-8')));
    } else {
      newMimes.push(decompressMime(item));
    }
  }
  resetMime();
  for (const item of newMimes) {
    registerMime(item);
  }
}
