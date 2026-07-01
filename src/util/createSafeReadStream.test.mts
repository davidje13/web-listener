import { constants, open } from 'node:fs/promises';
import type { EventEmitter } from 'node:stream';
import { createSafeReadStream } from './createSafeReadStream.mts';
import 'lean-test';

const testPath = new URL(import.meta.url).pathname;

describe('createSafeReadStream', () => {
  it('ensures close listeners are removed once the stream ends', { timeout: 3000 }, async () => {
    const handle = await open(testPath, constants.O_RDONLY);
    const originalClose = handle.close.bind(handle);
    handle.close = () => Promise.resolve(); // ensure we do not rely on the handle closing
    try {
      for await (const _ of createSafeReadStream(handle, { autoClose: false })) {
      }
      expect((handle as unknown as EventEmitter).listeners('close')).isEmpty();
    } finally {
      await originalClose();
    }
  });

  it('preserves the handle for future reads', { timeout: 3000 }, async () => {
    const handle = await open(testPath, constants.O_RDONLY);
    try {
      for await (const _ of createSafeReadStream(handle, { autoClose: false })) {
      }
      expect((handle as unknown as EventEmitter).listeners('close')).isEmpty();

      // handle is still open: can read it again
      for await (const _ of createSafeReadStream(handle, { autoClose: false })) {
      }
    } finally {
      await handle.close();
    }
  });

  it('ensures close listeners are removed if the stream is closed', { timeout: 3000 }, async () => {
    const handle = await open(testPath, constants.O_RDONLY);
    const originalClose = handle.close.bind(handle);
    handle.close = () => Promise.resolve(); // ensure we do not rely on the handle closing
    try {
      for await (const _ of createSafeReadStream(handle, { autoClose: false })) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect((handle as unknown as EventEmitter).listeners('close')).isEmpty();
    } finally {
      await originalClose();
    }
  });

  it('ensures close listeners are removed if the stream errors', { timeout: 3000 }, async () => {
    const handle = await open(testPath, constants.O_RDONLY);
    const originalClose = handle.close.bind(handle);
    handle.close = () => Promise.resolve(); // ensure we do not rely on the handle closing
    try {
      try {
        for await (const _ of createSafeReadStream(handle, { autoClose: false })) {
          throw new Error('oops');
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect((handle as unknown as EventEmitter).listeners('close')).isEmpty();
    } finally {
      await originalClose();
    }
  });

  it(
    'ensures close listeners are removed if the stream is destroyed',
    { timeout: 3000 },
    async () => {
      const handle = await open(testPath, constants.O_RDONLY);
      const originalClose = handle.close.bind(handle);
      handle.close = () => Promise.resolve(); // ensure we do not rely on the handle closing
      try {
        const stream = createSafeReadStream(handle, { autoClose: false });
        stream.on('error', () => {});
        stream.destroy(new Error('oops'));
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect((handle as unknown as EventEmitter).listeners('close')).isEmpty();
      } finally {
        await originalClose();
      }
    },
  );

  it(
    'ensures close listeners are removed if the stream is aborted by a signal',
    { timeout: 3000 },
    async () => {
      const handle = await open(testPath, constants.O_RDONLY);
      const originalClose = handle.close.bind(handle);
      handle.close = () => Promise.resolve(); // ensure we do not rely on the handle closing
      try {
        const ac = new AbortController();
        const stream = createSafeReadStream(handle, { autoClose: false, signal: ac.signal });
        stream.on('error', () => {});
        ac.abort(new Error('oops'));
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect((handle as unknown as EventEmitter).listeners('close')).isEmpty();
      } finally {
        await originalClose();
      }
    },
  );
});
