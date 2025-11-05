import { TransformStream } from 'node:stream/web';
import { text } from 'node:stream/consumers';
import { Duplex } from 'node:stream';
import { withServer } from '../../test-helpers/withServer.mts';
import { rawRequest } from '../../test-helpers/rawRequest.mts';
import { versionIsGreaterOrEqual } from '../../test-helpers/versionIsGreaterOrEqual.mts';
import { requestHandler } from '../../core/handler.mts';
import { sendCSVStream } from './sendCSV.mts';
import 'lean-test';

describe('sendCSVStream', () => {
  it('writes a CSV formatted table to the stream', { timeout: 3000 }, async () => {
    const output = Duplex.fromWeb(new TransformStream());
    await sendCSVStream(output, [
      ['A1', 'B1'],
      ['A2', 'B2'],
    ]);
    expect(await text(output)).equals('A1,B1\nA2,B2\n');
  });

  it('quotes values with special characters', { timeout: 3000 }, async () => {
    const output = Duplex.fromWeb(new TransformStream());
    await sendCSVStream(output, [['a\nb', 'c"quoted"', 'd,e']]);
    expect(await text(output)).equals('"a\nb","c""quoted""","d,e"\n');
  });

  it('writes nothing if given an empty list', { timeout: 3000 }, async () => {
    const output = Duplex.fromWeb(new TransformStream());
    await sendCSVStream(output, []);
    expect(await text(output)).equals('');
  });

  it('sets content headers on ServerResponse', { timeout: 3000 }, async () => {
    const handler = requestHandler(async (_, res) => {
      await sendCSVStream(res, [['v']]);
    });

    return withServer(handler, async (url) => {
      const res = await fetch(url);
      expect(res.headers.get('content-type')).equals('text/csv; charset=utf-8');
      expect(res.headers.has('content-length')).isFalse();
    });
  });

  it('sets the header content-type parameter if configured', { timeout: 3000 }, async () => {
    const handler = requestHandler(async (req, res) => {
      await sendCSVStream(res, [['v']], { headerRow: req.url === '/yes' });
    });

    return withServer(handler, async (url) => {
      const res1 = await fetch(url + '/yes');
      expect(res1.headers.get('content-type')).equals('text/csv; charset=utf-8; header=present');

      const res2 = await fetch(url + '/no');
      expect(res2.headers.get('content-type')).equals('text/csv; charset=utf-8; header=absent');
    });
  });

  it('uses alternative delimiters if configured', { timeout: 3000 }, async () => {
    const output = Duplex.fromWeb(new TransformStream());
    await sendCSVStream(
      output,
      [
        ['A1', 'B1'],
        ["A'2", 'B\t2'],
      ],
      { delimiter: '\t', newline: '\r\n', quote: "'" },
    );
    expect(await text(output)).equals("A1\tB1\r\n'A''2'\t'B\t2'\r\n");
  });

  it('does not close the stream if configured', { timeout: 3000 }, async () => {
    const output = Duplex.fromWeb(new TransformStream());
    await sendCSVStream(output, [['a', 'b']], { end: false });
    output.end('trailer');
    expect(await text(output)).equals('a,b\ntrailer');
  });

  it('accepts async row iterators', { timeout: 3000 }, async () => {
    const output = Duplex.fromWeb(new TransformStream());
    const source = async function* () {
      yield ['a', 'b'];
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield ['c', 'd'];
    };
    await sendCSVStream(output, source());
    expect(await text(output)).equals('a,b\nc,d\n');
  });

  it('accepts async cell iterators', { timeout: 3000 }, async () => {
    const output = Duplex.fromWeb(new TransformStream());
    const row = async function* () {
      yield 'a';
      await new Promise((resolve) => setTimeout(resolve, 10));
      yield 'b';
    };
    await sendCSVStream(output, [row(), row()]);
    expect(await text(output)).equals('a,b\na,b\n');
  });

  it('sends data on the wire efficiently', { timeout: 3000 }, async () => {
    assume(process.version, versionIsGreaterOrEqual('21.0')); // response corking is not supported in earlier versions

    const handler = requestHandler(async (_, res) => {
      await sendCSVStream(res, [
        ['A1', 'B1'],
        ['A2', 'B2'],
      ]);
    });

    return withServer(handler, async (url) => {
      const response = await rawRequest(url);
      expect(response).contains('A1,B1\nA2,B2\n');
    });
  });

  it('writes large values provided the stream is being consumed', { timeout: 3000 }, async () => {
    const large = 'x'.repeat(100000);
    const output = Duplex.fromWeb(new TransformStream());
    const outputText = text(output);
    await sendCSVStream(output, [['before', large, 'after']]);
    const content = await outputText;
    expect(content).startsWith('before,xxx');
    expect(content).endsWith('xxx,after\n');
    expect(content).hasLength(14 + large.length);
  });

  it('flushes to the wire if a large value is written', { timeout: 3000 }, async () => {
    assume(process.version, versionIsGreaterOrEqual('21.0')); // response corking is not supported in earlier versions

    const large = 'x'.repeat(100000);
    const handler = requestHandler(async (_, res) => {
      await sendCSVStream(res, [['before', large, 'after1', 'after2']]);
    });

    return withServer(handler, async (url) => {
      const res = await rawRequest(url);
      // chunk ends after large value, then shorter values are still combined into 1 chunk
      expect(res).contains('xxx\r\nf\r\n,after1,after2\n\r\n0\r\n\r\n');
    });
  });
});
