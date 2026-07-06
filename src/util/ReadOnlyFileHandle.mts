import type { Readable } from 'node:stream';
import type { CreateReadStreamOptions, FileHandle } from 'node:fs/promises';

export interface CloseableReadable extends Readable {
  close(): void;
}

export interface ReadOnlyFileHandle
  extends
    Pick<FileHandle, 'stat' | 'close' | typeof Symbol.asyncDispose>,
    Partial<Pick<FileHandle, 'read' | 'readFile' | 'readLines' | 'readableWebStream' | 'readv'>> {
  createReadStream(options?: CreateReadStreamOptions | undefined): CloseableReadable;

  noRandomAccess?: boolean | undefined;
}
