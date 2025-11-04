import { readFile } from 'node:fs/promises';
import { decompressMime, readMimeTypes, registerMime, resetMime } from '../index.mts';

export async function loadMime(mime: (string | Record<string, string>)[]) {
  const newMimes: Map<string, string>[] = [];
  for (const item of mime) {
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
