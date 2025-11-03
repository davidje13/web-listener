import { open, stat } from 'node:fs/promises';
import { ReadableStream } from 'node:stream/web';
import { Readable } from 'node:stream';
import { makeTestTempFile } from '../../test-helpers/makeFileStructure.mts';
import { withServer } from '../../test-helpers/withServer.mts';
import { requestHandler } from '../../core/handler.mts';
import { generateWeakETag } from '../cache/etag.mts';
import { sendFile } from './sendFile.mts';
import 'lean-test';

describe('sendFile', () => {
  it('streams file content to the client', { timeout: 3000 }, ({ getTyped }) => {
    const filePath = getTyped(TEST_FILE);
    const handler = requestHandler(async (req, res) => {
      const stats = await stat(filePath);
      await sendFile(req, res, filePath, stats);
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url);
      expect(res.status).equals(200);
      expect(res.headers.get('content-length')).equals('24');
      expect(await res.text()).equals('This is my file content.');
    });
  });

  it('fetches file stats internally if not provided', { timeout: 3000 }, ({ getTyped }) => {
    const filePath = getTyped(TEST_FILE);
    const handler = requestHandler(async (req, res) => {
      await sendFile(req, res, filePath, null);
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url);
      expect(res.status).equals(200);
      expect(res.headers.get('content-length')).equals('24');
      expect(await res.text()).equals('This is my file content.');
    });
  });

  it('does not send content for HEAD requests', { timeout: 3000 }, ({ getTyped }) => {
    const filePath = getTyped(TEST_FILE);
    const handler = requestHandler(async (req, res) => {
      const stats = await stat(filePath);
      await sendFile(req, res, filePath, stats);
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url, { method: 'HEAD' });
      expect(res.status).equals(200);
      expect(res.headers.get('content-length')).equals('24');
      expect(await res.text()).equals('');
    });
  });

  it('accepts an existing file handle', { timeout: 3000 }, ({ getTyped }) => {
    const filePath = getTyped(TEST_FILE);
    const handler = requestHandler(async (req, res) => {
      const handle = await open(filePath);
      try {
        const stats = await handle.stat();
        await sendFile(req, res, handle, stats);
      } finally {
        await handle.close();
      }
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url);
      expect(res.status).equals(200);
      expect(res.headers.get('content-length')).equals('24');
      expect(await res.text()).equals('This is my file content.');
    });
  });

  it('accepts a stream', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      const stream = Readable.from('hello');
      try {
        await sendFile(req, res, stream, { mtimeMs: Date.now(), size: 5 });
      } finally {
        stream.destroy();
      }
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url);
      expect(res.status).equals(200);
      expect(res.headers.get('content-length')).equals('5');
      expect(await res.text()).equals('hello');
    });
  });

  it('accepts a web stream', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      const stream = ReadableStream.from([Buffer.from('hello')]);
      try {
        await sendFile(req, res, stream, { mtimeMs: Date.now(), size: 5 });
      } finally {
        await stream.cancel();
      }
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url);
      expect(res.status).equals(200);
      expect(res.headers.get('content-length')).equals('5');
      expect(await res.text()).equals('hello');
    });
  });

  it('uses chunked encoding for streams if no file stats are provided', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      const stream = Readable.from('hello');
      try {
        await sendFile(req, res, stream, null);
      } finally {
        stream.destroy();
      }
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url);
      expect(res.status).equals(200);
      expect(res.headers.has('content-length')).isFalse();
      expect(res.headers.get('transfer-encoding')).equals('chunked');
      expect(await res.text()).equals('hello');
    });
  });

  it('handles if-modified-since', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      const stream = Readable.from('hello');
      try {
        await sendFile(req, res, stream, { size: 5, mtimeMs: Date.UTC(2020, 0, 1, 0, 0, 0, 0) });
      } finally {
        stream.destroy();
      }
    });

    return withServer(handler, async (url) => {
      const resModified = await fetch(url, {
        headers: { 'if-modified-since': 'Fri, 01 Jan 2010 00:00:00 GMT' },
      });
      expect(resModified.status).equals(200);
      expect(resModified.headers.get('content-length')).equals('5');
      expect(await resModified.text()).equals('hello');

      const resNotModified = await fetch(url, {
        headers: { 'if-modified-since': 'Thu, 02 Jan 2020 00:00:00 GMT' },
      });
      expect(resNotModified.status).equals(304);
      expect(resNotModified.headers.has('content-length')).isFalse();
      expect(await resNotModified.text()).equals('');

      // conditions are ignored for non-GET/HEAD
      const resPost = await fetch(url, {
        method: 'POST',
        headers: { 'if-modified-since': 'Thu, 02 Jan 2020 00:00:00 GMT' },
      });
      expect(resPost.status).equals(200);
      expect(await resPost.text()).equals('hello');
    });
  });

  it('handles if-none-match', { timeout: 3000 }, () => {
    const modified = Date.UTC(2020, 0, 1, 0, 0, 0, 0);
    const handler = requestHandler(async (req, res) => {
      const stream = Readable.from('hello');
      try {
        await sendFile(req, res, stream, { size: 5, mtimeMs: modified });
      } finally {
        stream.destroy();
      }
    });

    return withServer(handler, async (url) => {
      const res1 = await fetch(url, {
        headers: { 'if-none-match': 'W/"nope"' },
      });
      expect(res1.status).equals(200);
      expect(res1.headers.get('content-length')).equals('5');
      expect(await res1.text()).equals('hello');

      const res2 = await fetch(url, {
        headers: { 'if-none-match': generateWeakETag(undefined, { size: 5, mtimeMs: modified }) },
      });
      expect(res2.status).equals(304);
      expect(res2.headers.has('content-length')).isFalse();
      expect(await res2.text()).equals('');
    });
  });

  it('returns a range if requested', { timeout: 3000 }, ({ getTyped }) => {
    const filePath = getTyped(TEST_FILE);
    const handler = requestHandler(async (req, res) => {
      const stats = await stat(filePath);
      await sendFile(req, res, filePath, stats, { mergeOverlapDistance: 0 });
    });

    return withServer(handler, async (url, { expectError }) => {
      const resOne = await fetch(url, { headers: { range: 'bytes=5-10' } });
      expect(resOne.status).equals(206);
      expect(resOne.headers.get('accept-ranges')).equals('bytes');
      expect(resOne.headers.get('content-range')).equals('bytes 5-10/24');
      expect(await resOne.text()).equals('is my ');

      const resTwo = await fetch(url, { headers: { range: 'bytes=5-10,-5' } });
      expect(resTwo.status).equals(200);
      expect(resTwo.headers.has('content-range')).isFalse();
      expect(resTwo.headers.get('content-type')!).startsWith('multipart/byteranges; boundary=');
      const bodyTwo = await resTwo.text();
      expect(bodyTwo).contains('content-range: bytes 5-10/24\r\n\r\nis my \r\n');
      expect(bodyTwo).contains('content-range: bytes 19-23/24\r\n\r\ntent.\r\n');

      const resBad = await fetch(url, { headers: { range: 'bytes=999-999' } });
      expect(resBad.status).equals(416);
      expect(resBad.headers.get('content-range')).equals('bytes */24');
      expect(await resBad.text()).equals('');
      expectError('handling request /: HTTPError(416 Range Not Satisfiable)');

      // ranges are ignored for non-GET/HEAD
      const resPost = await fetch(url, { method: 'POST', headers: { range: 'bytes=5-10' } });
      expect(resPost.status).equals(200);
      expect(resPost.headers.has('accept-ranges')).isFalse();
      expect(await resPost.text()).equals('This is my file content.');
    });
  });

  const TEST_FILE = makeTestTempFile('sf-', 'file.txt', 'This is my file content.');
});
