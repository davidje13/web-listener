import { StreamSearch, type StreamSearchCallback } from './sbmh.mts';
import 'lean-test';

const tests = [
  {
    name: 'single character needle',
    needle: '\n',
    chunks: 'fo|o\n|bar|\nbaz\n|\n',
    expected: [
      [false, 'fo'],
      [true, 'o'],
      [false, 'bar'],
      [true, ''],
      [true, 'baz'],
      [true, ''],
    ],
  },
  {
    name: 'small needle',
    needle: '\r\n',
    chunks: 'foo| bar|\r|\n|baz, hello\r|\n world.|\r\n Node.JS rules!!\r\n\r\n',
    expected: [
      [false, 'foo'],
      [false, ' bar'],
      [true, ''],
      [false, 'baz, hello'],
      [true, ''],
      [false, ' world.'],
      [true, ''],
      [true, ' Node.JS rules!!'],
      [true, ''],
    ],
  },
  {
    name: 'medium needle',
    needle: '---foobarbaz',
    chunks: '---foobarbaz|asdf|\r\n|---foobarba|---foobar|ba|\r\n---foobarbaz--\r\n',
    expected: [
      [true, ''],
      [false, 'asdf'],
      [false, '\r\n'],
      [false, '---foobarba'],
      [false, '---foobarba'],
      [true, '\r\n'],
      [false, '--\r\n'],
    ],
  },
  {
    name: 'needle immediately after partial match',
    needle: '---foobarbaz',
    chunks: 'before---foobarba---foobarbazafter',
    expected: [
      [true, 'before---foobarba'],
      [false, 'after'],
    ],
  },
  {
    name: 'easily skippable needle',
    needle: 'abcdefghijklmnopqrstuvwxyz',
    chunks: '------------------abcdefghijklmnopqrstuvwxyzafter',
    expected: [
      [true, '------------------'],
      [false, 'after'],
    ],
  },
  {
    name: 'difficult needle',
    needle: '--------------------.',
    chunks: 'before------------------------------------------------------------.after',
    expected: [
      [true, 'before----------------------------------------'],
      [false, 'after'],
    ],
  },
  {
    name: 'end with partial needle',
    needle: 'abcd',
    chunks: 'ab',
    expected: [[false, 'ab']],
  },
  {
    name: 'end with partial difficult needle',
    needle: '--------------------.',
    chunks: '--------------------------------------',
    expected: [
      [false, '------------------'],
      [false, '--------------------'],
    ],
  },
  {
    name: 'at start',
    needle: '\r\n',
    chunks: '\r\nfoo',
    expected: [
      [true, ''],
      [false, 'foo'],
    ],
  },
  {
    name: 'empty section',
    needle: '\r\n',
    chunks: 'foo\r\n\r\nbar',
    expected: [
      [true, 'foo'],
      [true, ''],
      [false, 'bar'],
    ],
  },
  {
    name: 'at end',
    needle: '\r\n',
    chunks: 'foo\r\n',
    expected: [[true, 'foo']],
  },
  {
    name: 'no occurrence',
    needle: '\r\n',
    chunks: 'foo',
    expected: [[false, 'foo']],
  },
  {
    name: 'empty input',
    needle: '\r\n',
    chunks: '',
    expected: [],
  },
];

describe('StreamSearch', () => {
  it(
    'finds all occurrences of the needle in the stream',
    ({ needle, chunks, expected }: any) => {
      const results: CapturedResults = [];
      const ss = new StreamSearch(Buffer.from(needle, 'latin1'), collect(results));

      for (const chunk of chunks.split('|')) {
        ss.push(Buffer.from(chunk, 'latin1'));
      }
      ss.destroy();

      expect(results).equals(expected);
    },
    { parameters: tests },
  );

  it(
    'works when given one byte at a time',
    ({ needle, chunks, expected }: any) => {
      const results: CapturedResults = [];
      const ss = new StreamSearch(Buffer.from(needle, 'latin1'), collect(results));

      for (const chunk of chunks.split('|')) {
        const buf = Buffer.from(chunk, 'latin1');
        for (let i = 0; i < buf.length; ++i) {
          ss.push(buf.subarray(i, i + 1));
        }
      }
      ss.destroy();

      expect(mergeParts(results)).equals(mergeParts(expected));
    },
    { parameters: tests },
  );

  it('rejects an empty needle', () => {
    expect(() => new StreamSearch(Buffer.alloc(0), () => {})).throws(
      'cannot search for empty needle',
    );
  });
});

type CapturedResults = [boolean, string][];

const collect =
  (target: CapturedResults): StreamSearchCallback =>
  (isMatch, data, start, end) => {
    let value: string;
    if (end < start || start < 0 || end > data.byteLength) {
      value = `INVALID RANGE (${start} - ${end} / ${data.byteLength})`;
    } else {
      value = data.toString('latin1', start, end);
    }
    target.push([isMatch, value]);
  };

function mergeParts(items: CapturedResults) {
  const result: CapturedResults = [];
  let partial: string = '';
  for (const [match, text] of items) {
    partial += text;
    if (match) {
      result.push([true, partial]);
      partial = '';
    }
  }
  return [false, partial];
}
