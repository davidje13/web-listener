import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { TransformStream } from 'node:stream/web';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { inRequestHandler } from '../../test-helpers/withServer.mts';
import { makeTempFileStorage } from './tempFileStorage.mts';
import 'lean-test';

describe('makeTempFileStorage', () => {
  it('creates a temporary directory for storing files', { timeout: 3000 }, () =>
    inRequestHandler(async (req, _, { teardown }) => {
      const begin = Date.now();
      const storage = await makeTempFileStorage(req);
      expect(storage.dir).startsWith(join(tmpdir(), 'upload'));
      const s = await stat(storage.dir);
      expect(s.isDirectory()).isTrue();
      expect(Math.ceil(s.ctimeMs)).isGreaterThanOrEqual(begin); // ctimeMs can have higher precision

      await teardown();
      // directory is deleted once the request ends
      await expect(() => stat(storage.dir)).throws('ENOENT');
    }),
  );

  it('returns the same directory if called multiple times for a request', { timeout: 3000 }, () =>
    inRequestHandler(async (req) => {
      const storage1 = await makeTempFileStorage(req);
      const storage2 = await makeTempFileStorage(req);

      expect(storage2).same(storage1);
    }),
  );

  it('deletes the directory if the request ends while it is being created', { timeout: 3000 }, () =>
    inRequestHandler(async (req, res, { teardown }) => {
      const storagePromise = makeTempFileStorage(req);
      await new Promise((resolve) => res.end(resolve));
      const storage = await storagePromise;
      expect(storage.dir).startsWith(join(tmpdir(), 'upload'));

      await teardown();
      // wait for directory to finish being created, then immediately deleted
      await new Promise((resolve) => setTimeout(resolve, 50));
      await expect(() => stat(storage.dir)).throws('ENOENT');
    }),
  );

  describe('nextFile', () => {
    it('creates a unique filename in the temp directory', { timeout: 3000 }, () =>
      inRequestHandler(async (req) => {
        const storage = await makeTempFileStorage(req);
        const file1 = storage.nextFile();
        const file2 = storage.nextFile();

        expect(file1).startsWith(storage.dir + sep);
        expect(file2).startsWith(storage.dir + sep);
        expect(file2).not(equals(file1));
      }),
    );

    it('fails if called after the request closes', { timeout: 3000 }, () =>
      inRequestHandler(async (req, res) => {
        const storage = await makeTempFileStorage(req);
        await new Promise((resolve) => res.end(resolve));
        expect(() => storage.nextFile()).throws('STOP');
      }),
    );
  });

  describe('save', () => {
    it('writes a stream to a new unique file in the temp directory', { timeout: 3000 }, () =>
      inRequestHandler(async (req, _, { teardown }) => {
        const storage = await makeTempFileStorage(req);
        const file = await storage.save(Readable.from('hello'));

        expect(file.path).startsWith(storage.dir + sep);
        expect(file.size).equals(5);

        const s = await stat(file.path);
        expect(s.isFile()).isTrue();
        expect(s.size).equals(5);
        expect(s.mode & 0o777).equals(0o600);

        await teardown();
        await expect(() => stat(file.path)).throws('ENOENT');
      }),
    );

    it('fails if called after the request closes', { timeout: 3000 }, () =>
      inRequestHandler(async (req, res) => {
        const storage = await makeTempFileStorage(req);
        await new Promise((resolve) => res.end(resolve));
        await expect(() => storage.save(Readable.from('hello'))).throws('STOP');
      }),
    );

    it('stops if the writer errors', { timeout: 3000 }, () =>
      inRequestHandler(async (req, _) => {
        const storage = await makeTempFileStorage(req);
        const duplex = new TransformStream();
        const writer = duplex.writable.getWriter();
        const saver = storage.save(duplex.readable);

        writer.abort(new Error('gone'));
        await expect(saver).throws('gone');
      }),
    );

    it('stops if the request ends while writing', { timeout: 3000 }, () =>
      inRequestHandler(async (req, _, { teardown }) => {
        const storage = await makeTempFileStorage(req);
        const duplex = new TransformStream();
        const writer = duplex.writable.getWriter();
        const saver = storage.save(duplex.readable);

        await teardown();
        writer.write('foo');
        await expect(saver).throws('The operation was aborted');
      }),
    );
  });
});
