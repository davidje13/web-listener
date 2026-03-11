import { Readable } from 'node:stream';
import { withServer } from '../../test-helpers/withServer.mts';
import { rawRequest } from '../../test-helpers/rawRequest.mts';
import { versionIsGreaterOrEqual } from '../../test-helpers/versionIsGreaterOrEqual.mts';
import { writableString } from '../../test-helpers/writableString.mts';
import { requestHandler } from '../../core/handler.mts';
import { loadOnDemand } from './LoadOnDemand.mts';
import { sendCSVStream } from './sendCSV.mts';
import 'lean-test';

describe('sendCSVStream', () => {
  it('writes a CSV formatted table to the stream', { timeout: 3000 }, async () => {
    const output = writableString();
    await sendCSVStream(output, [
      ['A1', 'B1'],
      ['A2', 'B2'],
    ]);
    expect(output.currentText()).equals('A1,B1\nA2,B2\n');
  });

  it('quotes values with special characters', { timeout: 3000 }, async () => {
    const output = writableString();
    await sendCSVStream(output, [['a\nb', 'c"quoted"', 'd,e']]);
    expect(output.currentText()).equals('"a\nb","c""quoted""","d,e"\n');
  });

  it('writes nothing if given an empty list', { timeout: 3000 }, async () => {
    const output = writableString();
    await sendCSVStream(output, []);
    expect(output.currentText()).equals('');
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
    const output = writableString();
    await sendCSVStream(
      output,
      [
        ['A1', 'B1'],
        ["A'2", 'B\t2'],
      ],
      { delimiter: '\t', newline: '\r\n', quote: "'" },
    );
    expect(output.currentText()).equals("A1\tB1\r\n'A''2'\t'B\t2'\r\n");
  });

  it('does not close the stream if configured', { timeout: 3000 }, async () => {
    const output = writableString();
    await sendCSVStream(output, [['a', 'b']], { end: false });
    output.end('trailer');
    expect(output.currentText()).equals('a,b\ntrailer');
  });

  it('loads table data on demand', { timeout: 3000 }, async () => {
    const output = writableString();
    await sendCSVStream(
      output,
      loadOnDemand(() =>
        Promise.resolve([
          ['a', 'b'],
          ['c', 'd'],
        ]),
      ),
    );
    expect(output.currentText()).equals('a,b\nc,d\n');
  });

  it('loads row data on demand', { timeout: 3000 }, async () => {
    const output = writableString();
    await sendCSVStream(output, [
      loadOnDemand(() => Promise.resolve(['a', 'b'])),
      loadOnDemand(() => Promise.resolve(['c', 'd'])),
    ]);
    expect(output.currentText()).equals('a,b\nc,d\n');
  });

  it('accepts async row iterators', { timeout: 3000 }, async () => {
    const output = writableString();
    let finallyCalled = 0;
    const source = async function* () {
      try {
        yield ['a', 'b'];
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield ['c', 'd'];
      } finally {
        ++finallyCalled;
      }
    };
    await sendCSVStream(output, source());
    expect(output.currentText()).equals('a,b\nc,d\n');
    expect(finallyCalled).equals(1);
  });

  it('closes async row iterators if the request is cancelled', { timeout: 3000 }, async () => {
    const output = writableString();
    let started = 0;
    let finished = 0;
    let finallyCalled = 0;
    const source = async function* () {
      try {
        ++started;
        yield ['a', 'b'];
        await new Promise((resolve) => setTimeout(resolve, 1000));
        ++finished;
      } finally {
        ++finallyCalled;
      }
    };
    const promise = sendCSVStream(output, source());
    output.destroy();
    await promise;
    expect(started).equals(1);
    expect(finished).equals(0);
    expect(finallyCalled).equals(1);
  });

  it('loads cell data on demand', { timeout: 3000 }, async () => {
    const output = writableString();
    await sendCSVStream(output, [
      [loadOnDemand(() => Promise.resolve('a')), 'b'],
      ['c', loadOnDemand(() => Promise.resolve('d'))],
    ]);
    expect(output.currentText()).equals('a,b\nc,d\n');
  });

  it('accepts async cell iterators', { timeout: 3000 }, async () => {
    const output = writableString();
    let finallyCalled = 0;
    const row = async function* () {
      try {
        yield 'a';
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield 'b';
      } finally {
        ++finallyCalled;
      }
    };
    await sendCSVStream(output, [row(), row()]);
    expect(output.currentText()).equals('a,b\na,b\n');
    expect(finallyCalled).equals(2);
  });

  it('closes async cell iterators if the request is cancelled', { timeout: 3000 }, async () => {
    const output = writableString();
    let started = 0;
    let finished = 0;
    let finallyCalled = 0;
    const row = async function* () {
      try {
        ++started;
        yield 'a';
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield 'b';
        ++finished;
      } finally {
        ++finallyCalled;
      }
    };
    const promise = sendCSVStream(output, [row()]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    output.destroy();
    await promise;
    expect(started).equals(1);
    expect(finished).equals(0);
    expect(finallyCalled).equals(1);
  });

  it('consumes readable strings', { timeout: 3000 }, async () => {
    const output = writableString();
    await sendCSVStream(output, [
      [Readable.from(['This is', ' my "escaped" content']), Readable.from(['simple'])],
    ]);
    expect(output.currentText()).equals('"This is my ""escaped"" content","simple"\n');
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
    const output = writableString();
    await sendCSVStream(output, [['before', large, 'after']]);
    const content = output.currentText();
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
