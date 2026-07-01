import { constants, type FileHandle } from 'node:fs/promises';
import { text } from 'node:stream/consumers';
import { SharedFileHandle } from './SharedFileHandle.mts';
import 'lean-test';

const testPath = new URL(import.meta.url).pathname;

describe('SharedFileHandle', () => {
  it('creates file handles for the given path', { timeout: 3000 }, async () => {
    const sharedHandle = new SharedFileHandle(testPath, constants.O_RDONLY);
    const handle = await sharedHandle.open();
    try {
      await text(handle.createReadStream({ autoClose: false }));
    } finally {
      await handle.close();
    }
  });

  it('returns the same handle multiple times called sequentially', { timeout: 3000 }, async () => {
    const sharedHandle = new SharedFileHandle(testPath, constants.O_RDONLY);
    let handle1: FileHandle | undefined;
    let handle2: FileHandle | undefined;
    try {
      handle1 = await sharedHandle.open();
      handle2 = await sharedHandle.open();
      expect(handle2.fd).equals(handle1.fd);
    } finally {
      await handle1?.close();
      await handle2?.close();
    }
  });

  it('returns the same handle multiple times called in parallel', { timeout: 3000 }, async () => {
    const sharedHandle = new SharedFileHandle(testPath, constants.O_RDONLY);
    let handle1: FileHandle | undefined;
    let handle2: FileHandle | undefined;
    try {
      [handle1, handle2] = await Promise.all([sharedHandle.open(), sharedHandle.open()]);
      expect(handle2.fd).equals(handle1.fd);
    } finally {
      await handle1?.close();
      await handle2?.close();
    }
  });

  it('keeps the handle open for a short time', { timeout: 3000 }, async () => {
    const sharedHandle = new SharedFileHandle(testPath, constants.O_RDONLY, 10000);
    let handle1: FileHandle | undefined;
    let handle2: FileHandle | undefined;
    try {
      handle1 = await sharedHandle.open();
      const fd = handle1.fd;
      await handle1.close();
      handle1 = undefined;
      await new Promise((resolve) => setTimeout(resolve, 50));
      handle2 = await sharedHandle.open();
      expect(handle2.fd).equals(fd);
    } finally {
      await handle1?.close();
      await handle2?.close();
    }
  });

  it('closes the handle if all consumers are closed for a time', { timeout: 3000 }, async () => {
    const sharedHandle = new SharedFileHandle(testPath, constants.O_RDONLY, 0o666, 100);
    let handle1: FileHandle | undefined;
    let handle2: FileHandle | undefined;
    try {
      handle1 = await sharedHandle.open();
      const fd = handle1.fd;
      await handle1.close();
      handle1 = undefined;
      await new Promise((resolve) => setTimeout(resolve, 150));
      handle2 = await sharedHandle.open();
      expect(handle2.fd).not(equals(fd));
    } finally {
      await handle1?.close();
      await handle2?.close();
    }
  });

  it('does not close for other consumers if a handle is closed', { timeout: 3000 }, async () => {
    const sharedHandle = new SharedFileHandle(testPath, constants.O_RDONLY, 0o666, 100);
    let handle1: FileHandle | undefined;
    let handle2: FileHandle | undefined;
    try {
      handle1 = await sharedHandle.open();
      handle2 = await sharedHandle.open();
      await handle1.close();
      await text(handle2.createReadStream({ autoClose: false }));
    } finally {
      await handle1?.close();
      await handle2?.close();
    }
  });

  it('does not close for other consumers if a handle is consumed', { timeout: 3000 }, async () => {
    const sharedHandle = new SharedFileHandle(testPath, constants.O_RDONLY, 0o666, 100);
    let handle1: FileHandle | undefined;
    let handle2: FileHandle | undefined;
    try {
      handle1 = await sharedHandle.open();
      handle2 = await sharedHandle.open();
      await text(handle1.createReadStream({ autoClose: true }));
      await text(handle2.createReadStream({ autoClose: false }));
    } finally {
      await handle1?.close();
      await handle2?.close();
    }
  });

  it('does not close for other consumers if a stream errors', { timeout: 3000 }, async () => {
    const sharedHandle = new SharedFileHandle(testPath, constants.O_RDONLY, 0o666, 100);
    let handle1: FileHandle | undefined;
    let handle2: FileHandle | undefined;
    try {
      handle1 = await sharedHandle.open();
      handle2 = await sharedHandle.open();
      try {
        for await (const _ of handle1.createReadStream()) {
          throw new Error('oops');
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
      await text(handle2.createReadStream({ autoClose: false }));
    } finally {
      await handle1?.close();
      await handle2?.close();
    }
  });

  it('does not close for other consumers if a stream is destroyed', { timeout: 3000 }, async () => {
    const sharedHandle = new SharedFileHandle(testPath, constants.O_RDONLY, 0o666, 100);
    let handle1: FileHandle | undefined;
    let handle2: FileHandle | undefined;
    try {
      handle1 = await sharedHandle.open();
      handle2 = await sharedHandle.open();
      const stream = handle1.createReadStream();
      stream.once('error', () => {});
      stream.destroy(new Error('oops'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      await text(handle2.createReadStream({ autoClose: false }));
    } finally {
      await handle1?.close();
      await handle2?.close();
    }
  });

  it('does not close for other consumers if a stream is aborted', { timeout: 3000 }, async () => {
    const sharedHandle = new SharedFileHandle(testPath, constants.O_RDONLY, 0o666, 100);
    let handle1: FileHandle | undefined;
    let handle2: FileHandle | undefined;
    try {
      const ac = new AbortController();
      handle1 = await sharedHandle.open();
      handle2 = await sharedHandle.open();
      const stream = handle1.createReadStream({ signal: ac.signal });
      stream.once('error', () => {});
      ac.abort(new Error('nope'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      await text(handle2.createReadStream({ autoClose: false }));
    } finally {
      await handle1?.close();
      await handle2?.close();
    }
  });
});
