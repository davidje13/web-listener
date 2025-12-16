import { StreamSearch, type StreamSearchCallback } from './sbmh.mts';
import 'lean-test';

const tests: TestDef[] = [
  {
    name: 'single character needle',
    needle: '\n',
    chunks: 'fo|o\n|bar|\nbaz\n|\n',
    expected: ['fo', 'o', null, 'bar', '', null, 'baz', null, '', null],
  },
  {
    name: 'small needle',
    needle: '\r\n',
    chunks: 'foo| bar|\r|\n|baz, hello\r|\n world.|\r\n Node.JS rules!!\r\n\r\n',
    expected: [
      'foo',
      ' bar',
      '',
      null,
      'baz, hello',
      '',
      null,
      ' world.',
      '',
      null,
      ' Node.JS rules!!',
      null,
      '',
      null,
    ],
  },
  {
    name: 'medium needle',
    needle: '---foobarbaz',
    chunks: '---foobarbaz|asdf|\r\n|---foobarba|---foobar|ba|\r\n---foobarbaz--\r\n',
    expected: ['', null, 'asdf', '\r\n', '---foobarba', '---foobarba', '\r\n', null, '--\r\n'],
  },
  {
    name: 'needle immediately after partial match',
    needle: '---foobarbaz',
    chunks: 'before---foobarba---foobarbazafter',
    expected: ['before---foobarba', null, 'after'],
  },
  {
    name: 'easily skippable needle',
    needle: 'abcdefghijklmnopqrstuvwxyz',
    chunks: '------------------abcdefghijklmnopqrstuvwxyzafter',
    expected: ['------------------', null, 'after'],
  },
  {
    name: 'difficult needle',
    needle: '--------------------.',
    chunks: 'before------------------------------------------------------------.after',
    expected: ['before----------------------------------------', null, 'after'],
  },
  {
    name: 'end with partial needle',
    needle: 'abcd',
    chunks: 'ab',
    expected: ['ab'],
  },
  {
    name: 'end with partial difficult needle',
    needle: '--------------------.',
    chunks: '--------------------------------------',
    expected: ['------------------', '--------------------'],
  },
  {
    name: 'false match followed by match in lookbehind',
    needle: 'ababba',
    chunks: 'beforeabab|abbaafter',
    expected: ['before', 'ab', null, 'after'],
  },
  {
    name: 'partial false matches across boundaries',
    needle: 'ababba',
    chunks: '0|ababba1a|ababba2ab|ababba3aba|ababba4abab|ababba5ababb|xababba',
    expected: [
      '0',
      '',
      null,
      '1',
      'a',
      '',
      null,
      '2',
      'ab',
      '',
      null,
      '3',
      'aba',
      '',
      null,
      '4',
      'abab',
      '',
      null,
      '5',
      'ababb',
      'x',
      null,
    ],
  },
  {
    name: 'partial subsequent matches across boundaries',
    needle: 'ababba',
    chunks: '0|ababba1a|babba2ab|abba3aba|babba4abab|abba',
    expected: ['0', '', null, '1', '', null, '2', '', null, '3', 'ab', null, '4', 'ab', null],
  },
  {
    name: 'false matches across multiple boundaries',
    needle: '-----.',
    chunks: '--|--|---|x--|---x|-|--|--|-|.',
    expected: ['--', '-----', 'x', '--', '---x', '-', '', null],
  },
  {
    name: 'extended false match across multiple boundaries',
    needle: '-----.',
    chunks: '-|--|---|----|-----|----|---|--|-|--|----..........',
    expected: ['-', '----', '-----', '----', '---', '--', '-', '--', '----', null, '.........'],
  },
  {
    name: 'false match just before true match across boundary (repetitive needle with suffix)',
    needle: '-----.',
    chunks: '1--|--------.2--|-------.3--|------.4--|-----.5',
    expected: [
      '1',
      '--',
      '---',
      null,
      '2',
      '--',
      '--',
      null,
      '3',
      '--',
      '-',
      null,
      '4',
      '--',
      '',
      null,
      '5',
    ],
  },
  {
    name: 'false match just before true match across boundary (repetitive needle with prefix)',
    needle: '.-----',
    chunks: '1.-|---.-----2.-|--.-----3.-|-.-----4.-|.-----5..|-----6',
    expected: [
      '1',
      '.-',
      '---',
      null,
      '2',
      '.-',
      '--',
      null,
      '3',
      '.-',
      '-',
      null,
      '4',
      '.-',
      '',
      null,
      '5.',
      '',
      null,
      '6',
    ],
  },
  {
    name: 'false match just before true match across boundary (unique needle)',
    needle: 'abcdef',
    chunks: '1ab|cdeabcdef2ab|cdabcdef3ab|cabcdef4ab|abcdef5',
    expected: [
      '1',
      'ab',
      'cde',
      null,
      '2',
      'ab',
      'cd',
      null,
      '3',
      'ab',
      'c',
      null,
      '4',
      'ab',
      '',
      null,
      '5',
    ],
  },
  {
    name: 'at start',
    needle: '\r\n',
    chunks: '\r\nfoo',
    expected: ['', null, 'foo'],
  },
  {
    name: 'empty section',
    needle: '\r\n',
    chunks: 'foo\r\n\r\nbar',
    expected: ['foo', null, '', null, 'bar'],
  },
  {
    name: 'at end',
    needle: '\r\n',
    chunks: 'foo\r\n',
    expected: ['foo', null],
  },
  {
    name: 'no occurrence',
    needle: '\r\n',
    chunks: 'foo',
    expected: ['foo'],
  },
  {
    name: 'empty input',
    needle: '\r\n',
    chunks: '',
    expected: [],
  },
];

interface TestDef {
  name: string;
  needle: string;
  chunks: string;
  expected: (string | null)[];
}

describe('StreamSearch', () => {
  it(
    'finds all occurrences of the needle in the stream',
    ({ needle, chunks, expected }: any) => {
      const results: CapturedResults = [];
      const ss = new StreamSearch(Buffer.from(needle, 'latin1'), ...collect(results));

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
      const ss = new StreamSearch(Buffer.from(needle, 'latin1'), ...collect(results));

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
    expect(
      () =>
        new StreamSearch(
          Buffer.alloc(0),
          () => {},
          () => {},
        ),
    ).throws('invalid needle');
  });

  it('does not access undefined data', () => {
    const results: CapturedResults = [];
    const ss = new StreamSearch(Buffer.from('12341234'), ...collect(results));

    // this specifically checks that we do not search lookbehind data outside the
    // currently valid range. This can be from previous calls or uninitialised memory.

    ss.push(Buffer.from('1234123')); // seed lookbehind buffer
    ss.push(Buffer.from('12')); // fail lookbehind, set new shorter lookbehind
    ss.push(Buffer.from('4')); // fail lookbehind, ensure previous memory is not used
    ss.destroy();

    expect(results).equals(['1234123', '12', '4']);
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
            const ss = new StreamSearch(needle, ...collect(results));

            for (let i = 0; i < background.byteLength; i += split) {
              ss.push(background.subarray(i, i + split));
            }
            ss.destroy();

            const combined = mergeParts(results);
            expect(combined).hasLength(5);
            expect(combined[0]).hasLength(pos);
            expect(combined[1]).isNull();
            expect(combined[2]).hasLength(80 - pos - size);
            expect(combined[3]).isNull();
          }
        }
      }
    }
  });
});

type CapturedResults = (string | null)[];

const collect = (target: CapturedResults): [StreamSearchCallback, () => void] => [
  (data, start, end) => {
    let value: string;
    if (end < start || start < 0 || end > data.byteLength) {
      value = `INVALID RANGE (${start} - ${end} / ${data.byteLength})`;
    } else {
      value = data.toString('latin1', start, end);
    }
    target.push(value);
  },
  () => target.push(null),
];

function mergeParts(items: CapturedResults) {
  const result: CapturedResults = [];
  let partial: string = '';
  for (const item of items) {
    if (item === null) {
      result.push(partial);
      result.push(null);
      partial = '';
    } else {
      partial += item;
    }
  }
  result.push(partial);
  return result;
}
