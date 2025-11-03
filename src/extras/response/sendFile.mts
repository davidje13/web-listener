import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { stat, type FileHandle } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { createReadStream, type Stats } from 'node:fs';
import { getRange, type GetRangeOptions } from '../request/headers.mts';
import { checkIfModified, checkIfRange } from '../request/conditional.mts';
import { sendRanges } from '../response/sendRanges.mts';
import { simplifyRange, type SimplifyRangeOptions } from '../range.mts';
import { internalIsFileHandle } from '../../util/isFileHandle.mts';

export async function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  file: string | FileHandle | Readable | ReadableStream<Uint8Array>,
  fileStats: Pick<Stats, 'mtimeMs' | 'size'> | null,
  options?: GetRangeOptions & SimplifyRangeOptions,
) {
  if (!fileStats) {
    if (typeof file === 'string') {
      fileStats = await stat(file);
    } else if (internalIsFileHandle(file)) {
      fileStats = await file.stat();
    }
  }

  if (fileStats) {
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!checkIfModified(req, res, fileStats)) {
        res.writeHead(304).end();
        return;
      }

      res.setHeader('accept-ranges', 'bytes');
      const range = getRange(req, fileStats.size, options);
      if (range && checkIfRange(req, res, fileStats)) {
        return sendRanges(req, res, file, simplifyRange(range, options));
      }
    }
    res.setHeader('content-length', fileStats.size);
  }
  res.writeHead(res.statusCode, res.statusMessage);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  if (typeof file === 'string') {
    file = createReadStream(file);
  } else if (internalIsFileHandle(file)) {
    file = file.createReadStream({ start: 0, autoClose: false });
  }
  return pipeline(file, res);
}
