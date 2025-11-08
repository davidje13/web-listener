import type { IncomingMessage } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createWriteStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { addTeardown, getAbortSignal } from '../../core/close.mts';
import { STOP } from '../../core/RoutingInstruction.mts';
import { makeMemo } from '../properties.mts';

interface SavedFile {
  path: string;
  size: number;
}

export interface TempFileStorage {
  dir: string;
  nextFile: () => string;
  save: (
    stream: Readable | ReadableStream,
    options?: { mode?: number | undefined },
  ) => Promise<SavedFile>;
}

export const makeTempFileStorage = /*@__PURE__*/ makeMemo(
  async (req: IncomingMessage): Promise<TempFileStorage> => {
    const signal = getAbortSignal(req);
    if (signal.aborted) {
      throw STOP;
    }
    signal.throwIfAborted();
    const dir = await mkdtemp(join(tmpdir(), 'upload'));
    addTeardown(req, () => rm(dir, { recursive: true }));

    let fileIndex = 0;
    const nextFile = () => {
      if (signal.aborted) {
        throw STOP;
      }
      return join(dir, (++fileIndex).toString(10).padStart(6, '0'));
    };

    return {
      dir,
      nextFile,
      save: async (stream, { mode = 0o600 } = {}) => {
        const tempUploadPath = nextFile();
        const fileStream = createWriteStream(tempUploadPath, { mode });
        try {
          await pipeline(stream, fileStream, { signal });
          return { path: tempUploadPath, size: fileStream.bytesWritten };
        } finally {
          fileStream.close();
        }
      },
    };
  },
);
