import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ReadStream } from 'node:fs';
import { type FileHandle, open } from 'node:fs/promises';
import type { ReadableStream } from 'node:stream/web';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { internalEncodeHeaders } from '../../polyfill/SocketServerResponse.mts';
import { internalIsFileHandle } from '../../util/isFileHandle.mts';
import { StreamSlicer } from '../../util/StreamSlicer.mts';
import { simplifyRange, type HTTPRange } from '../range.mts';

// https://datatracker.ietf.org/doc/html/rfc7233

export async function sendRanges(
  req: IncomingMessage,
  res: ServerResponse,
  file: string | FileHandle | Readable | ReadableStream<Uint8Array>,
  httpRange: HTTPRange,
) {
  if (typeof file !== 'string' && !internalIsFileHandle(file)) {
    httpRange = simplifyRange(httpRange, { mergeOverlapDistance: 0, forceSequential: true });
  }
  if (httpRange.ranges.length === 1) {
    const range = httpRange.ranges[0]!;
    res.setHeader('content-length', range.end - range.start + 1);
    res.setHeader(
      'content-range',
      `bytes ${range.start}-${range.end}/${httpRange.totalSize ?? '*'}`,
    );
    res.writeHead(206);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const slicer = await getSlicer(file);
    await pipeline(slicer._get(range.start, range.end), res);
    if (slicer._end) {
      await slicer._end();
    }
    return;
  }
  const contentType = res.getHeader('content-type');
  // pick a random separator with a suffix that makes it more suited to efficient Boyer–Moore–Horspool searching
  const separator = randomUUID() + randomUUID() + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  res.setHeader('content-type', `multipart/byteranges; boundary=${separator}`);
  const sections = httpRange.ranges.map((range) => ({
    _head: [
      `--${separator}`,
      ...internalEncodeHeaders({
        'content-type': contentType,
        'content-range': `bytes ${range.start}-${range.end}/${httpRange.totalSize ?? '*'}`,
      }),
      '',
      '',
    ].join('\r\n'),
    _range: range,
  }));
  const terminator = `--${separator}--`;
  let length = terminator.length;
  for (const { _head, _range } of sections) {
    length += _head.length + _range.end - _range.start + 1 + 2;
  }
  res.setHeader('content-length', length);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  let trailing = '';
  const slicer = await getSlicer(file);
  try {
    for (const { _head, _range } of sections) {
      res.write(trailing + _head, 'ascii');
      await pipeline(slicer._get(_range.start, _range.end), res, { end: false });
      trailing = '\r\n';
    }
    res.end(trailing + terminator);
  } finally {
    if (slicer._end) {
      await slicer._end();
    }
  }
}

async function getSlicer(
  file: string | FileHandle | Readable | ReadableStream<Uint8Array>,
): Promise<{
  _get: (start: number, end: number) => ReadStream | ReadableStream;
  _end?: () => Promise<void>;
}> {
  if (typeof file === 'string') {
    const handle = await open(file, 'r');
    return {
      _get: (start, end) => handle.createReadStream({ start, end, autoClose: false }),
      _end: () => handle.close(),
    };
  } else if (internalIsFileHandle(file)) {
    return { _get: (start, end) => file.createReadStream({ start, end, autoClose: false }) };
  } else {
    const slicer = new StreamSlicer(file);
    return { _get: (start, end) => slicer.getRange(start, end), _end: () => slicer.close() };
  }
}
