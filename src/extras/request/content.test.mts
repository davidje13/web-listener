import { brotliCompressSync, deflateSync, gzipSync, zstdCompressSync } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { buffer } from 'node:stream/consumers';
import { inRequestHandler, withServer } from '../../test-helpers/withServer.mts';
import { makeStreamSearch } from '../../test-helpers/streamSearch.mts';
import { rawRequest, rawRequestStream } from '../../test-helpers/rawRequest.mts';
import { requestHandler } from '../../core/handler.mts';
import { getBodyJson, getBodyStream, getBodyText, getBodyTextStream } from './content.mts';
import '../../polyfill/fetch.mts';
import 'lean-test';

describe('getBodyStream', () => {
  it('returns a stream of body content', { timeout: 3000 }, () =>
    inRequestHandler(
      async (req) => {
        const stream = getBodyStream(req);
        const allContent = await buffer(stream);
        expect(allContent).equals(Buffer.from([0, 10, 20, 30]));
      },
      { method: 'POST', body: new Uint8Array([0, 10, 20, 30]) },
    ),
  );

  it('returns content as it becomes available', { timeout: 3000 }, () => {
    let stream: ReadableStream<Uint8Array> | undefined = undefined;
    const handler = requestHandler(async (req, res) => {
      stream = getBodyStream(req);
      req.once('close', () => res.end());
    });

    return withServer(handler, async (url) => {
      const input = new TransformStream<Uint8Array>();
      const writer = input.writable.getWriter();
      const req = fetch(url, { method: 'POST', body: input.readable, duplex: 'half' }).catch(fail);
      writer.write(Buffer.from('hello'));

      await expect.poll(() => stream, isTruthy(), { timeout: 500 });

      const received = makeStreamSearch(stream!, fail);

      await received.equals('hello');
      writer.write(Buffer.from(' world'));
      await received.equals('hello world');
      writer.close();
      await received.expectEnd();
      await req;
    });
  });

  it('stops if the request is aborted', { timeout: 3000 }, () => {
    const duplex = new TransformStream();
    const writer = duplex.writable.getWriter();
    writer.write('partial content');

    return inRequestHandler(
      async (req, _, { expectFetchError }) => {
        const stream = getBodyStream(req);
        expectFetchError();
        await writer.abort();
        await expect(() => buffer(stream)).throws('aborted');
      },
      { method: 'POST', body: duplex.readable, duplex: 'half' },
    );
  });

  it('sends 100 Continue if requested', { timeout: 3000 }, () => {
    let stream: ReadableStream<Uint8Array> | undefined = undefined;
    const handler = requestHandler(async (req, res) => {
      stream = getBodyStream(req);
      req.once('close', () => res.end());
    });

    return withServer(handler, async (url) => {
      const input = new TransformStream<Uint8Array>();
      const writer = input.writable.getWriter();
      const socket = await rawRequestStream(url, {
        method: 'POST',
        headers: { 'content-length': '18', expect: '100-continue' },
        body: input.readable,
      });

      const received = makeStreamSearch(socket, fail);

      await received.find('100 Continue');
      writer.write(Buffer.from('this is my content'));
      writer.close();

      const allContent = await buffer(stream!);
      expect(allContent).equals(Buffer.from('this is my content'));
      await received.expectEnd();
    });
  });

  it('throws if the content is too large', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      await buffer(getBodyStream(req, { maxContentLength: 5 }));
      res.end('success');
    });

    return withServer(handler, async (url, { expectError }) => {
      const res = await fetch(url, { method: 'POST', body: 'my content' });
      expect(res.status).equals(413);
      expect(await res.text()).equals('');
      expectError('handling request /: HTTPError(413 Payload Too Large)');
    });
  });

  it('throws if chunked content is too large', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      await buffer(getBodyStream(req, { maxContentLength: 5 }));
      res.end('success');
    });

    return withServer(handler, async (url, { expectError }) => {
      const res = await rawRequest(url, {
        method: 'POST',
        headers: { 'transfer-encoding': 'chunked' },
        body: 'my content',
      });
      expect(res).contains('413 Payload Too Large');
      expectError('handling request /: HTTPError(413 Payload Too Large)');
    });
  });

  it(
    'applies decoding depending on content-encoding',
    {
      timeout: 3000,
      parameters: [
        {
          name: 'gzip',
          body: gzipSync('this is my content'),
          expected: Buffer.from('this is my content', 'utf-8'),
        },
        {
          name: 'x-gzip',
          body: gzipSync('this is my content'),
          expected: Buffer.from('this is my content', 'utf-8'),
        },
        {
          name: 'deflate',
          body: deflateSync('this is my content'),
          expected: Buffer.from('this is my content', 'utf-8'),
        },
        {
          name: 'br',
          body: brotliCompressSync('this is my content'),
          expected: Buffer.from('this is my content', 'utf-8'),
        },
        {
          name: 'zstd',
          body: zstdCompressSync('this is my content'),
          expected: Buffer.from('this is my content', 'utf-8'),
        },
      ],
    },
    ({ name, body, expected }: any) =>
      inRequestHandler(
        async (req) => {
          const content = await buffer(getBodyStream(req));
          expect(content).equals(expected);
        },
        { method: 'POST', headers: { 'content-encoding': name }, body },
      ),
  );

  it('can apply multiple decoding steps if configured', { timeout: 3000 }, () =>
    inRequestHandler(
      async (req) => {
        const content = await buffer(getBodyStream(req, { maxEncodingSteps: 2 }));
        expect(content).equals(Buffer.from('this is my content', 'utf-8'));
      },
      {
        method: 'POST',
        headers: { 'content-encoding': 'gzip, br' },
        body: brotliCompressSync(gzipSync('this is my content')),
      },
    ),
  );

  it('throws if content-encoding contains too many steps', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      await buffer(getBodyStream(req, { maxEncodingSteps: 2 }));
      res.end('success');
    });

    return withServer(handler, async (url, { expectError }) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-encoding': 'gzip, gzip, gzip' },
        body: 'my content',
      });
      expect(res.status).equals(415);
      expect(await res.text()).equals('too many content-encoding stages');
      expectError('handling request /: HTTPError(415 Unsupported Media Type)');
    });
  });

  it('throws if the content-encoding is unknown', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      await buffer(getBodyStream(req));
      res.end('success');
    });

    return withServer(handler, async (url, { expectError }) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-encoding': 'foo' },
        body: 'my content',
      });
      expect(res.status).equals(415);
      expect(await res.text()).equals('unknown content encoding');
      expectError('handling request /: HTTPError(415 Unsupported Media Type)');
    });
  });

  it('throws if the decoded content is too large', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      await buffer(getBodyStream(req, { maxExpandedLength: 500 }));
      res.end();
    });

    return withServer(handler, async (url, { expectError }) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-encoding': 'gzip' },
        body: gzipSync('content which compresses well' + '.'.repeat(1000)),
      });
      expect(res.status).equals(413);
      expect(await res.text()).equals('decoded content too large');
      expectError('handling request /: HTTPError(413 Payload Too Large)');
    });
  });
});

describe('getBodyTextStream', () => {
  it('decodes content based on the content-type encoding', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      await pipeline(getBodyTextStream(req), res);
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'text/plain; charset=utf-16le' },
        body: Buffer.from('hello\u2026', 'utf-16le'),
      });
      expect(Buffer.from(await res.bytes())).equals(Buffer.from('hello\u2026', 'utf-8'));
    });
  });

  it('decodes as utf-8 by default', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      await pipeline(getBodyTextStream(req), res);
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'unknown' },
        body: Buffer.from('hello\u2026', 'utf-8'),
      });
      expect(Buffer.from(await res.bytes())).equals(Buffer.from('hello\u2026', 'utf-8'));
    });
  });
});

describe('getBodyText', () => {
  it('returns the full text content from the request', { timeout: 3000 }, () =>
    inRequestHandler(
      async (req) => {
        const content = await getBodyText(req);
        expect(content).equals('hello\u2026');
      },
      {
        method: 'POST',
        headers: { 'content-type': 'text/plain; charset=utf-16le' },
        body: Buffer.from('hello\u2026', 'utf-16le'),
      },
    ),
  );
});

describe('getBodyJson', () => {
  it('returns the full JSON content from the request', { timeout: 3000 }, () =>
    inRequestHandler(
      async (req) => {
        const content = await getBodyJson(req);
        expect(content).equals({ foo: 'bar' });
      },
      { method: 'POST', body: JSON.stringify({ foo: 'bar' }) },
    ),
  );

  it('detects the unicode encoding automatically', { timeout: 3000 }, async () => {
    const input = { foo: 'bar\u2026' };
    const inputStr = JSON.stringify(input);

    await inRequestHandler(
      async (req) => {
        expect(await getBodyJson(req)).equals(input);
      },
      { method: 'POST', body: inputStr },
    );

    await inRequestHandler(
      async (req) => {
        expect(await getBodyJson(req)).equals(input);
      },
      { method: 'POST', body: Buffer.from(inputStr, 'utf-16le') },
    );
  });
});
