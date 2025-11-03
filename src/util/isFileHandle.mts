import type { FileHandle } from 'node:fs/promises';

export function internalIsFileHandle(o: unknown): o is FileHandle {
  if (!o || typeof o !== 'object') {
    return false;
  }
  const test = o as FileHandle;
  return (
    typeof test.fd === 'number' &&
    typeof test.stat === 'function' &&
    typeof test.createReadStream === 'function'
  );
}
