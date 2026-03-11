import { Readable } from 'node:stream';
import { withServer } from '../../test-helpers/withServer.mts';
import { rawRequest } from '../../test-helpers/rawRequest.mts';
import { versionIsGreaterOrEqual } from '../../test-helpers/versionIsGreaterOrEqual.mts';
import { writableString } from '../../test-helpers/writableString.mts';
import { requestHandler } from '../../core/handler.mts';
import { loadOnDemand } from './LoadOnDemand.mts';
import { sendJSON, sendJSONStream } from './sendJSON.mts';
import 'lean-test';

describe('sendJSON', () => {
  it('writes JSON formatted data to the stream', () => {
    const output = writableString();
    sendJSON(output, { foo: 'bar' });
    expect(output.currentText()).equals('{"foo":"bar"}');
  });

  it('passes replacer and space to JSON.stringify', () => {
    const output = writableString();
    sendJSON(output, { foo: 'bar' }, { replacer: (_, v) => (v === 'bar' ? 'sub' : v), space: 1 });
    expect(output.currentText()).equals('{\n "foo": "sub"\n}');
  });

  it('sends undefined as null if configured', () => {
    const output = writableString();
    sendJSON(output, undefined, { undefinedAsNull: true });
    expect(output.currentText()).equals('null');
  });

  it('does not close the stream if configured', () => {
    const output = writableString();
    sendJSON(output, 'foo', { end: false });
    output.end('trailer');
    expect(output.currentText()).equals('"foo"trailer');
  });

  it('sets content headers on ServerResponse', { timeout: 3000 }, () => {
    const handler = requestHandler((_, res) => {
      sendJSON(res, { foo: 'bar' });
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url);
      expect(res.headers.get('content-type')).equals('application/json');
      expect(res.headers.get('content-length')).equals('13');
    });
  });

  it('sends content synchronously in a single chunk', { timeout: 3000 }, () => {
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
      const output = writableString();
      await sendJSONStream(output, input, options);
      expect(output.currentText()).equals(JSON.stringify(input, options.replacer, options.space));
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
      const output = writableString();
      sendJSON(output, input, options);
      const streamOutput = writableString();
      await sendJSONStream(streamOutput, input, options);
      expect(streamOutput.currentBuffer()).equals(output.currentBuffer());
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

  it('loads root data on demand', { timeout: 3000 }, async () => {
    const output = writableString();
    await sendJSONStream(
      output,
      loadOnDemand(() => Promise.resolve('loaded')),
    );
    expect(output.currentText()).equals('"loaded"');
  });

  it('loads nested data on demand', { timeout: 3000 }, async () => {
    const output = writableString();
    await sendJSONStream(output, {
      foo: loadOnDemand(() => Promise.resolve('loaded')),
    });
    expect(output.currentText()).equals('{"foo":"loaded"}');
  });

  it('iterates through iterable lists', { timeout: 3000 }, async () => {
    const output = writableString();
    let finallyCalled = 0;
    await sendJSONStream(output, {
      foo: (function* () {
        try {
          yield 'one';
          yield 'two';
        } finally {
          ++finallyCalled;
        }
      })(),
    });
    expect(output.currentText()).equals('{"foo":["one","two"]}');
    expect(finallyCalled).equals(1);
  });

  it('closes iterators if the request is cancelled', { timeout: 3000 }, async () => {
    const output = writableString();
    let started = 0;
    let finished = 0;
    let finallyCalled = 0;
    const promise = sendJSONStream(
      output,
      (function* () {
        try {
          ++started;
          yield loadOnDemand(() => Promise.resolve('one'));
          yield 'two';
          ++finished;
        } finally {
          ++finallyCalled;
        }
      })(),
    );
    output.destroy();
    await promise;
    expect(started).equals(1);
    expect(finished).equals(0);
    expect(finallyCalled).equals(1);
  });

  it('iterates through async iterable lists', { timeout: 3000 }, async () => {
    const output = writableString();
    let finallyCalled = 0;
    await sendJSONStream(output, {
      foo: (async function* () {
        try {
          yield 'one';
          await new Promise((resolve) => setTimeout(resolve, 10));
          yield 'two';
        } finally {
          ++finallyCalled;
        }
      })(),
    });
    expect(output.currentText()).equals('{"foo":["one","two"]}');
    expect(finallyCalled).equals(1);
  });

  it('closes async iterators if the request is cancelled', { timeout: 3000 }, async () => {
    const output = writableString();
    let started = 0;
    let finished = 0;
    let finallyCalled = 0;
    const promise = sendJSONStream(output, {
      foo: (async function* () {
        try {
          ++started;
          yield 'one';
          await new Promise((resolve) => setTimeout(resolve, 10));
          yield 'two';
          ++finished;
        } finally {
          ++finallyCalled;
        }
      })(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    output.destroy();
    await promise;
    expect(started).equals(1);
    expect(finished).equals(0);
    expect(finallyCalled).equals(1);
  });

  it('iterates through Sets', { timeout: 3000 }, async () => {
    const output = writableString();
    await sendJSONStream(output, {
      foo: new Set(['one', 'two']),
    });
    expect(output.currentText()).equals('{"foo":["one","two"]}');
  });

  it('iterates through Maps', { timeout: 3000 }, async () => {
    const output = writableString();
    await sendJSONStream(output, {
      foo: new Map([
        ['one', 1],
        ['two', 2],
      ]),
    });
    expect(output.currentText()).equals('{"foo":{"one":1,"two":2}}');
  });

  it('consumes readable strings', { timeout: 3000 }, async () => {
    const output = writableString();
    await sendJSONStream(output, {
      foo: Readable.from(['This is', ' my "escaped" content']),
    });
    expect(output.currentText()).equals('{"foo":"This is my \\"escaped\\" content"}');
  });

  it('sends data on the wire efficiently', { timeout: 3000 }, async () => {
    assume(process.version, versionIsGreaterOrEqual('21.0')); // response corking is not supported in earlier versions

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
    const output = writableString();
    await sendJSONStream(output, ['before', large, 'after']);
    const content = output.currentText();
    expect(content).startsWith('["before","xxx');
    expect(content).endsWith('xxx","after"]');
    expect(content).hasLength(21 + large.length);
  });

  it('stops writing if the stream is not being consumed', { timeout: 3000 }, async () => {
    const large = 'x'.repeat(100000);
    const output = writableString();
    output.pause();
    const promise = sendJSONStream(output, ['before', large, 'after']);
    expect.poll(() => output.currentText().length, isGreaterThan(0));
    expect(output.currentText().length).isLessThan(21 + large.length);
    output.unpause();
    await promise;
    expect(output.currentText().length).equals(21 + large.length);
  });

  it('flushes to the wire if a large value is written', { timeout: 3000 }, async () => {
    assume(process.version, versionIsGreaterOrEqual('21.0')); // response corking is not supported in earlier versions

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
