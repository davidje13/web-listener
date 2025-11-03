import { ServerResponse } from 'node:http';
import type { Writable } from 'node:stream';
import { VOID_BUFFER } from './voidBuffer.mts';

export const internalDrainUncorked = (target: Writable) =>
  new Promise<void>((resolve) => {
    const next = () => {
      target.cork();
      resolve();
    };
    if (target instanceof ServerResponse) {
      // Work around a Node.js bug where drain fails to fire for corked responses,
      // but the write callback still works correctly.
      // See: https://github.com/nodejs/node/issues/60432
      target.write(VOID_BUFFER, next);
    } else {
      target.once('drain', next);
    }
    target.uncork();
  });
