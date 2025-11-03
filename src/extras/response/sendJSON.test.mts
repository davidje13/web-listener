import { TransformStream } from 'node:stream/web';
import { text, buffer } from 'node:stream/consumers';
import { Duplex, Readable } from 'node:stream';
import { withServer } from '../../test-helpers/withServer.mts';
import { rawRequest } from '../../test-helpers/rawRequest.mts';
import { requestHandler } from '../../core/handler.mts';
import { sendJSON, sendJSONStream } from './sendJSON.mts';
import 'lean-test';

describe('sendJSON', () => {
  it('writes JSON formatted data to the stream', { timeout: 3000 }, async () => {
    const output = Duplex.fromWeb(new TransformStream());
    sendJSON(output, { foo: 'bar' });
    expect(await text(output)).equals('{"foo":"bar"}');
  });

  it('passes replacer and space to JSON.stringify', { timeout: 3000 }, async () => {
    const output = Duplex.fromWeb(new TransformStream());
    sendJSON(output, { foo: 'bar' }, { replacer: (_, v) => (v === 'bar' ? 'sub' : v), space: 1 });
    expect(await text(output)).equals('{\n "foo": "sub"\n}');
  });

  it('sends undefined as null if configured', { timeout: 3000 }, async () => {
    const output = Duplex.fromWeb(new TransformStream());
    sendJSON(output, undefined, { undefinedAsNull: true });
    expect(await text(output)).equals('null');
  });

  it('does not close the stream if configured', { timeout: 3000 }, async () => {
    const output = Duplex.fromWeb(new TransformStream());
    sendJSON(output, 'foo', { end: false });
    output.end('trailer');
    expect(await text(output)).equals('"foo"trailer');
  });

  it('sets content headers on ServerResponse', { timeout: 3000 }, async () => {
    const handler = requestHandler((_, res) => {
      sendJSON(res, { foo: 'bar' });
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url);
      expect(res.headers.get('content-type')).equals('application/json');
      expect(res.headers.get('content-length')).equals('13');
    });
  });

  it('sends content synchronously in a single chunk', { timeout: 3000 }, async () => {
    const handler = requestHandler((_, res) => {
      sendJSON(res, { foo: 'bar' }, { end: false });
      res.end();
    });

    return withServer(handler, async (url) => {
      const response = await rawRequest(url);
      expect(response).contains('{"foo":"bar"}');
    });
  });
});

describe('sendJSONStream', () => {
  it(
    'produces the same output as JSON.stringify for basic objects',
    {
      parameters: [
        { input: false },
        { input: true },
        { input: null },
        { input: 0 },
        { input: 1 },
        { input: -1.2 },
        { input: 100000000 },
        { input: '' },
        { input: 'foo' },
        { input: 'quoted "parts"' },
        { input: '\u2026' },
        { input: [] },
        { input: ['item'] },
        { input: [false] },
        { input: [null] },
        { input: [undefined] },
        { input: [0] },
        { input: {} },
        { input: { foo: 'bar' } },
        { input: { foo: null } },
        { input: { foo: undefined } },
        { input: { foo: 0 } },
        { input: { [Symbol('hi')]: 1 } },
        { input: { foo: [1, 2, 'three'], bar: { 0: 1 } } },
        { input: { foo: [1, 2, 'three'], bar: { 0: 1 } }, options: { space: 1 } },
        { input: { foo: [1, 2, 'three'], bar: { 0: 1 } }, options: { space: 2 } },
        { input: { foo: [1, 2, 'three'], bar: { 0: 1 } }, options: { space: 8 } },
        { input: { foo: [1, 2, 'three'], bar: { 0: 1 } }, options: { space: 10 } },
        { input: { foo: [1, 2, 'three'], bar: { 0: 1 } }, options: { space: '\t' } },
        { input: { foo: { foo: [1, 2], bar: 3 }, bar: 4, 5: 6 }, options: { replacer: ['foo'] } },
        { input: { foo: { foo: [1, 2], bar: 3 }, bar: 4, 5: 6 }, options: { replacer: [5] } },
        {
          input: { foo: [1, 2, 'three'], bar: { 0: 1 } },
          options: { replacer: (_: unknown, v: unknown) => (v === 'three' ? 3 : v) },
        },
        { input: new Date(100000) },
      ],
      timeout: 3000,
    },
    async ({ input, options = {} }: any) => {
      const output = Duplex.fromWeb(new TransformStream());
      const outputText = text(output);
      await sendJSONStream(output, input, options);
      expect(await outputText).equals(JSON.stringify(input, options.replacer, options.space));
    },
  );

  it(
    'applies encoding and undefinedAsNull in the same way as sendJSON',
    {
      parameters: [
        { input: undefined },
        { input: undefined, options: { undefinedAsNull: true } },
        { input: ['item'] },
        { input: ['item'], options: { encoding: 'utf-16le' } },
      ],
      timeout: 3000,
    },
    async ({ input, options = {} }: any) => {
      const output = Duplex.fromWeb(new TransformStream());
      sendJSON(output, input, options);
      const streamOutput = Duplex.fromWeb(new TransformStream());
      const streamOutBuffer = buffer(streamOutput);
      await sendJSONStream(streamOutput, input, options);
      expect(await streamOutBuffer).equals(await buffer(output));
    },
  );

  it('sets content headers on ServerResponse', { timeout: 3000 }, async () => {
    const handler = requestHandler(async (_, res) => {
      await sendJSONStream(res, { foo: 'bar' });
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url);
      expect(res.headers.get('content-type')).equals('application/json');
      expect(res.headers.has('content-length')).isFalse();
    });
  });

  it('iterates through iterable lists', { timeout: 3000 }, async () => {
    const output = Duplex.fromWeb(new TransformStream());
    const streamOutText = text(output);
    await sendJSONStream(output, {
      foo: (function* () {
        yield 'one';
        yield 'two';
      })(),
    });
    expect(await streamOutText).equals('{"foo":["one","two"]}');
  });

  it('iterates through async iterable lists', { timeout: 3000 }, async () => {
    const output = Duplex.fromWeb(new TransformStream());
    const streamOutText = text(output);
    await sendJSONStream(output, {
      foo: (async function* () {
        yield 'one';
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield 'two';
      })(),
    });
    expect(await streamOutText).equals('{"foo":["one","two"]}');
  });

  it('iterates through Sets', { timeout: 3000 }, async () => {
    const output = Duplex.fromWeb(new TransformStream());
    const streamOutText = text(output);
    await sendJSONStream(output, {
      foo: new Set(['one', 'two']),
    });
    expect(await streamOutText).equals('{"foo":["one","two"]}');
  });

  it('iterates through Maps', { timeout: 3000 }, async () => {
    const output = Duplex.fromWeb(new TransformStream());
    const streamOutText = text(output);
    await sendJSONStream(output, {
      foo: new Map([
        ['one', 1],
        ['two', 2],
      ]),
    });
    expect(await streamOutText).equals('{"foo":{"one":1,"two":2}}');
  });

  it('consumes readable strings', { timeout: 3000 }, async () => {
    const output = Duplex.fromWeb(new TransformStream());
    const streamOutText = text(output);
    await sendJSONStream(output, {
      foo: Readable.from(['This is', ' my "escaped" content']),
    });
    expect(await streamOutText).equals('{"foo":"This is my \\"escaped\\" content"}');
  });

  it('sends data on the wire efficiently', { timeout: 3000 }, async () => {
    const handler = requestHandler(async (_, res) => {
      await sendJSONStream(res, { foo: 'bar' });
    });

    return withServer(handler, async (url) => {
      const response = await rawRequest(url);
      expect(response).contains('{"foo":"bar"}');
    });
  });

  it('writes large values provided the stream is being consumed', { timeout: 3000 }, async () => {
    const large = 'x'.repeat(100000);
    const output = Duplex.fromWeb(new TransformStream());
    const outputText = text(output);
    await sendJSONStream(output, ['before', large, 'after']);
    const content = await outputText;
    expect(content).startsWith('["before","xxx');
    expect(content).endsWith('xxx","after"]');
    expect(content).hasLength(21 + large.length);
  });

  it('flushes to the wire if a large value is written', { timeout: 3000 }, async () => {
    const large = 'x'.repeat(100000);
    const handler = requestHandler(async (_, res) => {
      await sendJSONStream(res, ['before', large, 'after1', 'after2']);
    });

    return withServer(handler, async (url) => {
      const res = await rawRequest(url);
      // chunk ends after large value, then shorter values are still combined into 1 chunk
      expect(res).contains('xxx"\r\n13\r\n,"after1","after2"]\r\n0\r\n\r\n');
    });
  });
});
