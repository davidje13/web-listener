import { open } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';
import { makeTestTempFile } from '../../test-helpers/makeFileStructure.mts';
import { rawRequestStream } from '../../test-helpers/rawRequest.mts';
import { withServer } from '../../test-helpers/withServer.mts';
import { requestHandler } from '../../core/handler.mts';
import { sendRanges } from './sendRanges.mts';
import 'lean-test';

describe('sendRanges', () => {
  describe('single range', () => {
    it('returns partial content', { timeout: 3000 }, ({ getTyped }) => {
      const filePath = getTyped(TEST_FILE);
      const handler = requestHandler(async (req, res) => {
        await sendRanges(req, res, filePath, {
          ranges: [{ start: 10, end: 19 }],
          totalSize: 24,
        });
      });

      return withServer(handler, async (url) => {
        const res = await fetch(url);
        expect(res.status).equals(206);
        expect(res.headers.get('content-range')).equals('bytes 10-19/24');
        expect(res.headers.get('content-length')).equals('10');
        expect(await res.text()).equals(' file cont');

        const resHEAD = await fetch(url, { method: 'HEAD' });
        expect(resHEAD.status).equals(206);
        expect(resHEAD.headers.get('content-range')).equals('bytes 10-19/24');
        expect(resHEAD.headers.get('content-length')).equals('10');
        expect(await resHEAD.text()).equals('');
      });
    });

    it('uses a wildcard if the total filesize is unknown', { timeout: 3000 }, ({ getTyped }) => {
      const filePath = getTyped(TEST_FILE);
      const handler = requestHandler(async (req, res) => {
        await sendRanges(req, res, filePath, {
          ranges: [{ start: 10, end: 19 }],
          totalSize: undefined,
        });
      });

      return withServer(handler, async (url) => {
        const res = await fetch(url);
        expect(res.headers.get('content-range')).equals('bytes 10-19/*');
      });
    });

    it('accepts an existing file handle', { timeout: 3000 }, ({ getTyped }) => {
      const filePath = getTyped(TEST_FILE);
      const handler = requestHandler(async (req, res) => {
        const handle = await open(filePath);
        try {
          await sendRanges(req, res, handle, {
            ranges: [{ start: 10, end: 19 }],
            totalSize: 24,
          });
        } finally {
          await handle.close();
        }
      });

      return withServer(handler, async (url) => {
        const res = await fetch(url);
        expect(res.status).equals(206);
        expect(res.headers.get('content-range')).equals('bytes 10-19/24');
        expect(res.headers.get('content-length')).equals('10');
        expect(await res.text()).equals(' file cont');
      });
    });

    it('accepts a stream', { timeout: 3000 }, () => {
      const handler = requestHandler(async (req, res) => {
        const stream = Readable.from('hello');
        try {
          await sendRanges(req, res, stream, {
            ranges: [{ start: 1, end: 3 }],
            totalSize: 5,
          });
        } finally {
          stream.destroy();
        }
      });

      return withServer(handler, async (url) => {
        const res = await fetch(url);
        expect(res.status).equals(206);
        expect(res.headers.get('content-range')).equals('bytes 1-3/5');
        expect(res.headers.get('content-length')).equals('3');
        expect(await res.text()).equals('ell');
      });
    });

    it('accepts a web stream', { timeout: 3000 }, () => {
      const handler = requestHandler(async (req, res) => {
        const stream = ReadableStream.from([Buffer.from('hello')]);
        try {
          await sendRanges(req, res, stream, {
            ranges: [{ start: 1, end: 3 }],
            totalSize: 5,
          });
        } finally {
          await stream.cancel();
        }
      });

      return withServer(handler, async (url) => {
        const res = await fetch(url);
        expect(res.status).equals(206);
        expect(res.headers.get('content-range')).equals('bytes 1-3/5');
        expect(res.headers.get('content-length')).equals('3');
        expect(await res.text()).equals('ell');
      });
    });

    it('ignores requests which close quickly', { timeout: 3000 }, ({ getTyped }) => {
      const filePath = getTyped(TEST_FILE);
      const handler = requestHandler(async (req, res) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        await sendRanges(req, res, filePath, {
          ranges: [{ start: 10, end: 19 }],
          totalSize: 24,
        });
      });

      return withServer(handler, async (url) => {
        const socket = await rawRequestStream(url);
        socket.destroy();
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
    });
  });

  describe('multiple ranges', () => {
    it('returns multipart/byteranges content', { timeout: 3000 }, ({ getTyped }) => {
      const filePath = getTyped(TEST_FILE);
      const handler = requestHandler(async (req, res) => {
        await sendRanges(req, res, filePath, {
          ranges: [
            { start: 0, end: 4 },
            { start: 10, end: 14 },
          ],
          totalSize: 24,
        });
      });

      return withServer(handler, async (url) => {
        const res = await fetch(url);
        expect(res.status).equals(200);
        expect(res.headers.has('content-range')).isFalse();
        expect(res.headers.get('content-type')!).startsWith('multipart/byteranges; boundary=');
        const body = await res.text();
        expect(body).contains('content-range: bytes 0-4/24\r\n\r\nThis \r\n--');
        expect(body).contains('content-range: bytes 10-14/24\r\n\r\n file\r\n--');
      });
    });

    it('moves the content-type header into the body', { timeout: 3000 }, ({ getTyped }) => {
      const filePath = getTyped(TEST_FILE);
      const handler = requestHandler(async (req, res) => {
        res.setHeader('content-type', 'foo/bar');
        await sendRanges(req, res, filePath, {
          ranges: [
            { start: 0, end: 4 },
            { start: 10, end: 14 },
          ],
          totalSize: 24,
        });
      });

      return withServer(handler, async (url) => {
        const res = await fetch(url);
        const body = await res.text();
        expect(body).contains('content-type: foo/bar\r\ncontent-range: bytes 0-4/24\r\n');
        expect(body).contains('content-type: foo/bar\r\ncontent-range: bytes 10-14/24\r\n');
      });
    });

    it('accepts an existing file handle', { timeout: 3000 }, ({ getTyped }) => {
      const filePath = getTyped(TEST_FILE);
      const handler = requestHandler(async (req, res) => {
        const handle = await open(filePath);
        try {
          await sendRanges(req, res, handle, {
            ranges: [
              { start: 0, end: 4 },
              { start: 10, end: 14 },
            ],
            totalSize: 24,
          });
        } finally {
          await handle.close();
        }
      });

      return withServer(handler, async (url) => {
        const res = await fetch(url);
        expect(res.status).equals(200);
        const body = await res.text();
        expect(body).contains('content-range: bytes 0-4/24\r\n\r\nThis \r\n--');
        expect(body).contains('content-range: bytes 10-14/24\r\n\r\n file\r\n--');
      });
    });

    it('accepts a stream', { timeout: 3000 }, () => {
      const handler = requestHandler(async (req, res) => {
        const stream = Readable.from('hello');
        try {
          await sendRanges(req, res, stream, {
            ranges: [
              { start: 0, end: 1 },
              { start: 3, end: 4 },
            ],
            totalSize: 5,
          });
        } finally {
          stream.destroy();
        }
      });

      return withServer(handler, async (url) => {
        const res = await fetch(url);
        expect(res.status).equals(200);
        const body = await res.text();
        expect(body).contains('content-range: bytes 0-1/5\r\n\r\nhe\r\n--');
        expect(body).contains('content-range: bytes 3-4/5\r\n\r\nlo\r\n--');
      });
    });

    it('forces sequential ranges when given a stream', { timeout: 3000 }, () => {
      const handler = requestHandler(async (req, res) => {
        const stream = Readable.from('hello');
        try {
          await sendRanges(req, res, stream, {
            ranges: [
              { start: 3, end: 4 },
              { start: 2, end: 2 },
              { start: 0, end: 0 },
            ],
            totalSize: 5,
          });
        } finally {
          stream.destroy();
        }
      });

      return withServer(handler, async (url) => {
        const res = await fetch(url);
        expect(res.status).equals(200);
        const body = await res.text();
        expect(body).contains('content-range: bytes 0-0/5\r\n\r\nh\r\n--');
        expect(body).contains('content-range: bytes 2-4/5\r\n\r\nllo\r\n--');
      });
    });

    it('accepts a web stream', { timeout: 3000 }, () => {
      const handler = requestHandler(async (req, res) => {
        const stream = ReadableStream.from([Buffer.from('hello')]);
        try {
          await sendRanges(req, res, stream, {
            ranges: [
              { start: 0, end: 1 },
              { start: 3, end: 4 },
            ],
            totalSize: 5,
          });
        } finally {
          await stream.cancel();
        }
      });

      return withServer(handler, async (url) => {
        const res = await fetch(url);
        expect(res.status).equals(200);
        const body = await res.text();
        expect(body).contains('content-range: bytes 0-1/5\r\n\r\nhe\r\n--');
        expect(body).contains('content-range: bytes 3-4/5\r\n\r\nlo\r\n--');
      });
    });

    it('ignores requests which close quickly', { timeout: 3000 }, ({ getTyped }) => {
      const filePath = getTyped(TEST_FILE);
      const handler = requestHandler(async (req, res) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        await sendRanges(req, res, filePath, {
          ranges: [
            { start: 0, end: 4 },
            { start: 10, end: 14 },
          ],
          totalSize: 24,
        });
      });

      return withServer(handler, async (url) => {
        const socket = await rawRequestStream(url);
        socket.destroy();
        await new Promise((resolve) => setTimeout(resolve, 200));
      });
    });
  });

  const TEST_FILE = makeTestTempFile('sr-', 'file.txt', 'This is my file content.');
});
