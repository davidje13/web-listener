import { Writable } from 'node:stream';

export const writableString = () => {
  const chunks: Buffer[] = [];
  let paused = false;
  const queuedCallbacks: (() => void)[] = [];
  const writable = new Writable({
    decodeStrings: false,
    write(chunk, encoding, callback) {
      if (chunk instanceof Buffer) {
        chunks.push(chunk);
      } else if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk, encoding));
      } else {
        return callback(new Error(`invalid content: ${typeof chunk} ${JSON.stringify(chunk)}`));
      }
      if (paused) {
        queuedCallbacks.push(callback);
      } else {
        callback();
      }
    },
  });
  return Object.assign(writable, {
    currentText: (encoding: BufferEncoding = 'utf-8') => Buffer.concat(chunks).toString(encoding),
    currentBuffer: () => Buffer.concat(chunks),
    pause() {
      paused = true;
    },
    unpause() {
      const callbacks = [...queuedCallbacks];
      queuedCallbacks.length = 0;
      paused = false;
      for (const cb of callbacks) {
        cb();
      }
    },
  });
};
