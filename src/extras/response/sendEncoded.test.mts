import { ReadableStream } from 'node:stream/web';
import { Readable } from 'node:stream';
import { rawRequestStream } from '../../test-helpers/rawRequest.mts';
import { withServer } from '../../test-helpers/withServer.mts';
import { requestHandler } from '../../core/handler.mts';
import { sendEncoded } from './sendEncoded.mts';
import 'lean-test';

describe('sendEncoded', () => {
  it('streams content to the client', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      const contentStream = Readable.from([
        Buffer.from('Hello ', 'utf-8'),
        Buffer.from('world!', 'utf-8'),
      ]);
      await sendEncoded(req, res, contentStream);
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url, { headers: { 'accept-encoding': 'identity' } });
      expect(res.status).equals(200);
      expect(res.headers.get('content-length')).isNull();
      expect(res.headers.get('transfer-encoding')).equals('chunked');
      expect(await res.text()).equals('Hello world!');
    });
  });

  it('applies compression if requested', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      const contentStream = Readable.from([Buffer.from('content', 'utf-8')]);
      await sendEncoded(req, res, contentStream);
    });

    return withServer(handler, async (url) => {
      const resDeflate = await fetch(url, { headers: { 'accept-encoding': 'deflate' } });
      expect(resDeflate.status).equals(200);
      expect(resDeflate.headers.get('content-encoding')).equals('deflate');
      expect(await resDeflate.text()).equals('content');

      const resGzip = await fetch(url, { headers: { 'accept-encoding': 'gzip' } });
      expect(resGzip.status).equals(200);
      expect(resGzip.headers.get('content-encoding')).equals('gzip');
      expect(await resGzip.text()).equals('content');

      const resBrotli = await fetch(url, { headers: { 'accept-encoding': 'br' } });
      expect(resBrotli.status).equals(200);
      expect(resBrotli.headers.get('content-encoding')).equals('br');
      expect(await resBrotli.text()).equals('content');

      const resZstd = await fetch(url, { headers: { 'accept-encoding': 'zstd' } });
      expect(resZstd.status).equals(200);
      expect(resZstd.headers.get('content-encoding')).equals('zstd');
      // zstd is not supported by fetch in Node.js 22
      //expect(await resZstd.text()).equals('content');

      const resMulti = await fetch(url, {
        headers: { 'accept-encoding': 'deflate; q=0.1, br; q=0.8, gzip; q=0.2' },
      });
      expect(resMulti.status).equals(200);
      expect(resMulti.headers.get('content-encoding')).equals('br');
    });
  });

  it('does not send content for HEAD requests', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      const contentStream = Readable.from([Buffer.from('content', 'utf-8')]);
      await sendEncoded(req, res, contentStream);
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url, { method: 'HEAD', headers: { 'accept-encoding': 'identity' } });
      expect(res.status).equals(200);
      expect(res.headers.get('content-length')).isNull();
      expect(await res.text()).equals('');
    });
  });

  it('accepts a web stream', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      const stream = ReadableStream.from([Buffer.from('hello')]);
      try {
        await sendEncoded(req, res, stream);
      } finally {
        await stream.cancel();
      }
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url, { headers: { 'accept-encoding': 'identity' } });
      expect(res.status).equals(200);
      expect(res.headers.get('content-length')).isNull();
      expect(res.headers.get('transfer-encoding')).equals('chunked');
      expect(await res.text()).equals('hello');
    });
  });

  it('accepts a buffer', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      await sendEncoded(req, res, Buffer.from('content', 'utf-8'));
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url, { headers: { 'accept-encoding': 'identity' } });
      expect(res.status).equals(200);
      expect(res.headers.get('x-reflect')).isNull();
      expect(res.headers.get('content-length')).equals('7');
      expect(res.headers.get('transfer-encoding')).isNull();
      expect(await res.text()).equals('content');

      const resHead = await fetch(url, {
        method: 'HEAD',
        headers: { 'accept-encoding': 'identity' },
      });
      expect(resHead.headers.get('content-length')).equals('7');
      expect(resHead.headers.get('transfer-encoding')).isNull();
      expect(await resHead.text()).equals('');
    });
  });

  it('accepts a string with encoding', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      await sendEncoded(req, res, 'content \u263A', { encoding: 'utf-8' });
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url, { headers: { 'accept-encoding': 'identity' } });
      expect(res.status).equals(200);
      expect(res.headers.get('content-length')).equals('11'); // measured in encoded bytes
      expect(res.headers.get('transfer-encoding')).isNull();
      expect(await res.text()).equals('content \u263A');
    });
  });

  it('ignores requests which close quickly', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await sendEncoded(req, res, Buffer.from('hello', 'utf-8'));
    });

    return withServer(handler, async (url) => {
      const socket = await rawRequestStream(url);
      socket.destroy();
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
  });

  it('closes the response if the stream errors', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      await sendEncoded(req, res, largeFailingStream());
    });

    return withServer(handler, async (url, { expectError }) => {
      const res = await fetch(url, { headers: { 'accept-encoding': 'identity' } });
      expect(res.status).equals(200);
      await expect(() => res.text()).throws('terminated');
      expectError('handling request /: Error: oops');
    });
  });

  it('closes the response if the stream errors while compressing', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      await sendEncoded(req, res, largeFailingStream());
    });

    return withServer(handler, async (url, { expectError }) => {
      const res = await fetch(url, { headers: { 'accept-encoding': 'gzip' } });
      expect(res.status).equals(200);
      await expect(() => res.text()).throws('terminated');
      expectError('handling request /: Error: oops');
    });
  });

  it('ignores requests which close while data is being sent', { timeout: 3000 }, () => {
    const handler = requestHandler((req, res) =>
      sendEncoded(
        req,
        res,
        Readable.from(
          (async function* () {
            while (true) {
              yield Buffer.from([1]);
            }
          })(),
        ),
      ),
    );

    return withServer(handler, async (url) => {
      const socket = await rawRequestStream(url);
      let seen = Number.POSITIVE_INFINITY;
      socket.once('data', (data) => {
        seen = data.length;
        socket.destroy(); // close connection while data is being sent back
      });

      // wait a moment for send to finish and potentially error
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(seen).isLessThan(70000);
    });
  });
});

const largeFailingStream = () =>
  Readable.from(
    (async function* () {
      // must emit enough data for compression to begin & start streaming
      const chunk = Buffer.from('a'.repeat(1000), 'utf-8');
      for (let i = 0; i < 100; ++i) {
        yield chunk;
      }
      // then error
      throw new Error('oops');
    })(),
    { highWaterMark: 1 },
  );
