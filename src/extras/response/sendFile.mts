import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { stat, type FileHandle } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { createReadStream, type Stats } from 'node:fs';
import { internalIsFileHandle } from '../../util/isFileHandle.mts';
import { internalIsPrematureCloseError } from '../../util/isPrematureCloseError.mts';
import { STOP } from '../../core/RoutingInstruction.mjs';
import { getRange, type GetRangeOptions } from '../request/headers.mts';
import { checkIfModified, checkIfRange } from '../request/conditional.mts';
import { sendRanges } from '../response/sendRanges.mts';
import { simplifyRange, type SimplifyRangeOptions } from '../range.mts';

export async function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  source: string | FileHandle | Readable | ReadableStream<Uint8Array>,
  fileStats: Pick<Stats, 'mtimeMs' | 'size'> | null = null,
  options?: GetRangeOptions & SimplifyRangeOptions,
) {
  if (res.closed || !res.writable) {
    throw STOP; // client closed connection; don't bother loading file
  }

  if (!fileStats) {
    if (typeof source === 'string') {
      fileStats = await stat(source);
    } else if (internalIsFileHandle(source)) {
      fileStats = await source.stat();
    }
    if (res.closed || !res.writable) {
      throw STOP; // client closed connection while we were loading file stats
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
        return sendRanges(req, res, source, simplifyRange(range, options));
      }
    }
    res.setHeader('content-length', fileStats.size);
  }
  res.writeHead(res.statusCode, res.statusMessage);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  if (typeof source === 'string') {
    source = createReadStream(source);
  } else if (internalIsFileHandle(source)) {
    source = source.createReadStream({ start: 0, autoClose: false });
  }
  try {
    await pipeline(source, res);
  } catch (error: unknown) {
    throw internalIsPrematureCloseError(res, error) ? STOP : error;
  }
}
