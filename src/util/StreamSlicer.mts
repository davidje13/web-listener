import { Readable } from 'node:stream';
import {
  ReadableStream,
  type ReadableStreamDefaultReader,
  type ReadableStreamController,
} from 'node:stream/web';

export class StreamSlicer {
  /** @internal */ private readonly _reader: ReadableStreamDefaultReader<unknown>;
  /** @internal */ private _buffer: Uint8Array | null;
  /** @internal */ private _pos: number;
  /** @internal */ private _state: number;

  constructor(stream: Readable | ReadableStream<Uint8Array>) {
    if (internalIsNodeReadable(stream)) {
      stream = Readable.toWeb(stream);
    }
    this._reader = stream.getReader();
    this._buffer = null;
    this._pos = 0;
    this._state = 0;
  }

  getRange(start: number, end: number): ReadableStream<Uint8Array> {
    if (end < start) {
      throw new Error('invalid range');
    }
    if (start < this._pos) {
      throw new Error('non-sequential range');
    }
    if (this._state) {
      throw new Error('previous range still active');
    }
    let limit = end - start + 1;
    let skip = start - this._pos;
    this._pos = end + 1;
    this._state = 1;
    const self = this;

    const handleChunk = (chunk: Uint8Array, controller: ReadableStreamController<Uint8Array>) => {
      const n = chunk.byteLength;
      if (n <= skip) {
        skip -= n;
        return;
      }
      if (n > skip + limit) {
        this._buffer = chunk.subarray(skip + limit);
        controller.enqueue(chunk.subarray(skip, skip + limit));
        limit = 0;
      } else if (skip > 0) {
        controller.enqueue(chunk.subarray(skip));
        limit -= n - skip;
        skip = 0;
      } else {
        controller.enqueue(chunk);
        limit -= n;
      }
    };

    return new ReadableStream({
      start(controller) {
        if (self._buffer) {
          const chunk = self._buffer;
          self._buffer = null;
          handleChunk(chunk, controller);
        }
      },
      async pull(controller) {
        if (limit <= 0) {
          self._state = 0;
          controller.close();
          return;
        }
        const next = await self._reader.read();
        if (next.done) {
          controller.error(new Error('range exceeds content'));
        } else {
          if (typeof next.value === 'string') {
            handleChunk(Buffer.from(next.value, 'utf-8'), controller);
          } else if (next.value instanceof Uint8Array) {
            handleChunk(next.value, controller);
          } else {
            controller.error(new Error('invalid stream type: must contain bytes or UTF-8 text'));
          }
        }
      },
    });
  }

  async close() {
    await this._reader.cancel();
    this._reader.releaseLock();
  }
}

function internalIsNodeReadable(stream: Readable | ReadableStream<any>): stream is Readable {
  const test = stream as Readable;
  return typeof test._read === 'function' && typeof test.pipe === 'function';
}
