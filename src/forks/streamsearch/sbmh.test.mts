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
    name: 'false match followed by match in lookbehind',
    needle: 'ababba',
    chunks: 'beforeabab|abbaafter',
    expected: [
      [false, 'before'],
      [true, 'ab'],
      [false, 'after'],
    ],
  },
  {
    name: 'partial false matches across boundaries',
    needle: 'ababba',
    chunks: '0|ababba1a|ababba2ab|ababba3aba|ababba4abab|ababba5ababb|xababba',
    expected: [
      [false, '0'],
      [true, ''],
      [false, '1'],
      [false, 'a'],
      [true, ''],
      [false, '2'],
      [false, 'ab'],
      [true, ''],
      [false, '3'],
      [false, 'aba'],
      [true, ''],
      [false, '4'],
      [false, 'abab'],
      [true, ''],
      [false, '5'],
      [false, 'ababb'],
      [true, 'x'],
    ],
  },
  {
    name: 'partial subsequent matches across boundaries',
    needle: 'ababba',
    chunks: '0|ababba1a|babba2ab|abba3aba|babba4abab|abba',
    expected: [
      [false, '0'],
      [true, ''],
      [false, '1'],
      [true, ''],
      [false, '2'],
      [true, ''],
      [false, '3'],
      [true, 'ab'],
      [false, '4'],
      [true, 'ab'],
    ],
  },
  {
    name: 'false matches across multiple boundaries',
    needle: '-----.',
    chunks: '--|--|---|x--|---x|-|--|--|-|.',
    expected: [
      [false, '--'],
      [false, '-----'],
      [false, 'x'],
      [false, '--'],
      [false, '---x'],
      [false, '-'],
      [true, ''],
    ],
  },
  {
    name: 'extended false match across multiple boundaries',
    needle: '-----.',
    chunks: '-|--|---|----|-----|----|---|--|-|--|----..........',
    expected: [
      [false, '-'],
      [false, '----'],
      [false, '-----'],
      [false, '----'],
      [false, '---'],
      [false, '--'],
      [false, '-'],
      [false, '--'],
      [true, '----'],
      [false, '.........'],
    ],
  },
  {
    name: 'false match just before true match across boundary (repetitive needle with suffix)',
    needle: '-----.',
    chunks: '1--|--------.2--|-------.3--|------.4--|-----.5',
    expected: [
      [false, '1'],
      [false, '--'],
      [true, '---'],
      [false, '2'],
      [false, '--'],
      [true, '--'],
      [false, '3'],
      [false, '--'],
      [true, '-'],
      [false, '4'],
      [false, '--'],
      [true, ''],
      [false, '5'],
    ],
  },
  {
    name: 'false match just before true match across boundary (repetitive needle with prefix)',
    needle: '.-----',
    chunks: '1.-|---.-----2.-|--.-----3.-|-.-----4.-|.-----5..|-----6',
    expected: [
      [false, '1'],
      [false, '.-'],
      [true, '---'],
      [false, '2'],
      [false, '.-'],
      [true, '--'],
      [false, '3'],
      [false, '.-'],
      [true, '-'],
      [false, '4'],
      [false, '.-'],
      [true, ''],
      [false, '5.'],
      [true, ''],
      [false, '6'],
    ],
  },
  {
    name: 'false match just before true match across boundary (unique needle)',
    needle: 'abcdef',
    chunks: '1ab|cdeabcdef2ab|cdabcdef3ab|cabcdef4ab|abcdef5',
    expected: [
      [false, '1'],
      [false, 'ab'],
      [true, 'cde'],
      [false, '2'],
      [false, 'ab'],
      [true, 'cd'],
      [false, '3'],
      [false, 'ab'],
      [true, 'c'],
      [false, '4'],
      [false, 'ab'],
      [true, ''],
      [false, '5'],
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
    expect(() => new StreamSearch(Buffer.alloc(0), () => {})).throws('invalid needle');
  });

  it('reliably finds needles regardless of position and chunk boundaries', () => {
    const needleTypes = [
      Buffer.alloc(10).fill(1),
      Buffer.from('abcdefghij'),
      Buffer.from('.---------'),
    ];
    for (const needleType of needleTypes) {
      for (let size = 1; size < needleType.byteLength; ++size) {
        const needle = needleType.subarray(0, size);
        for (let pos = 0; pos < 30; ++pos) {
          const background = Buffer.alloc(100);
          background.set(needle, pos);
          background.set(needle, 80);

          for (let split = 1; split < 20; ++split) {
            const results: CapturedResults = [];
            const ss = new StreamSearch(needle, collect(results));

            for (let i = 0; i < background.byteLength; i += split) {
              ss.push(background.subarray(i, i + split));
            }
            ss.destroy();

            const combined = mergeParts(results);
            expect(combined).hasLength(3);
            expect(combined[0]![1]).hasLength(pos);
            expect(combined[1]![1]).hasLength(80 - pos - size);
          }
        }
      }
    }
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
  result.push([false, partial]);
  return result;
}
