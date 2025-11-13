import type { BusboyOptions } from './types.mts';
import { busboy } from './busboy.mts';
import 'lean-test';

const COMMON_INFO = {
  nameTruncated: false,
  valueTruncated: false,
  encoding: 'utf-8',
  mimeType: 'text/plain',
};

const tests: TestDef[] = [
  // simple keys and values
  { name: 'foo', expected: [['foo', '', COMMON_INFO]] },
  { name: 'foo=bar', expected: [['foo', 'bar', COMMON_INFO]] },
  { name: 'foo=', expected: [['foo', '', COMMON_INFO]] },
  { name: '=bar', expected: [['', 'bar', COMMON_INFO]] },
  { name: '=', expected: [['', '', COMMON_INFO]] },
  {
    name: 'foo&bar=baz',
    expected: [
      ['foo', '', COMMON_INFO],
      ['bar', 'baz', COMMON_INFO],
    ],
  },
  {
    name: 'foo=bar&baz',
    expected: [
      ['foo', 'bar', COMMON_INFO],
      ['baz', '', COMMON_INFO],
    ],
  },
  {
    name: 'foo=bar&baz=bla',
    expected: [
      ['foo', 'bar', COMMON_INFO],
      ['baz', 'bla', COMMON_INFO],
    ],
  },
  {
    name: 'foo&bar',
    expected: [
      ['foo', '', COMMON_INFO],
      ['bar', '', COMMON_INFO],
    ],
  },
  {
    name: 'foo&bar&',
    expected: [
      ['foo', '', COMMON_INFO],
      ['bar', '', COMMON_INFO],
    ],
  },
  {
    name: '=&baz',
    expected: [
      ['', '', COMMON_INFO],
      ['baz', '', COMMON_INFO],
    ],
  },
  {
    name: '=bar&baz',
    expected: [
      ['', 'bar', COMMON_INFO],
      ['baz', '', COMMON_INFO],
    ],
  },
  {
    name: 'foo=&baz',
    expected: [
      ['foo', '', COMMON_INFO],
      ['baz', '', COMMON_INFO],
    ],
  },

  // blank fields
  { name: 'blank', source: '', expected: [] },
  { name: '&', expected: [] },
  { name: '&&&&&', expected: [] },
  { name: '&&foo=bar&&', expected: [['foo', 'bar', COMMON_INFO]] },

  // character escapes
  {
    name: 'encoded bytes',
    source: 'foo%20bar=baz%20bla%21',
    expected: [['foo bar', 'baz bla!', COMMON_INFO]],
  },
  {
    name: 'plus maps to space',
    source: 'foo+1=bar+baz%2Bquux',
    expected: [['foo 1', 'bar baz+quux', COMMON_INFO]],
  },
  {
    name: 'foo=bar%20%21&num=1000',
    expected: [
      ['foo', 'bar !', COMMON_INFO],
      ['num', '1000', COMMON_INFO],
    ],
  },
  {
    name: 'unencoded equals symbol',
    source: 'foo=bar=baz',
    expected: [['foo', 'bar=baz', COMMON_INFO]],
  },

  // character sets
  {
    name: 'multi-byte charset',
    charset: 'UTF-16LE',
    source: `${percentEncode('foo', 'utf-16le')}=${percentEncode('😀!', 'utf-16le')}`,
    expected: [['foo', '😀!', { ...COMMON_INFO, encoding: 'UTF-16LE' }]],
  },
  {
    name: 'single-byte, ASCII-compatible, non-UTF-8 charset',
    charset: 'ISO-8859-1',
    source: `foo=<${percentEncode('©:^þ', 'latin1')}`,
    expected: [['foo', '<©:^þ', { ...COMMON_INFO, encoding: 'ISO-8859-1' }]],
  },

  // limits
  {
    name: 'fields=0 reached',
    source: '',
    options: { limits: { fields: 0 } },
    expected: [],
  },
  {
    name: 'fields=0 exceeded',
    source: 'foo',
    options: { limits: { fields: 0 } },
    expected: ['fieldsLimit'],
  },
  {
    name: 'fields=1 reached',
    source: 'foo=bar',
    options: { limits: { fields: 1 } },
    expected: [['foo', 'bar', COMMON_INFO]],
  },
  {
    name: 'fields=1 exceeded',
    source: 'foo=bar&baz=bla',
    options: { limits: { fields: 1 } },
    expected: [['foo', 'bar', COMMON_INFO], 'fieldsLimit'],
  },
  {
    name: 'fields=2 reached',
    source: 'foo=bar&baz=bla',
    options: { limits: { fields: 2 } },
    expected: [
      ['foo', 'bar', COMMON_INFO],
      ['baz', 'bla', COMMON_INFO],
    ],
  },
  {
    name: 'fields=2 exceeded',
    source: 'foo=bar&baz=bla&more',
    options: { limits: { fields: 2 } },
    expected: [['foo', 'bar', COMMON_INFO], ['baz', 'bla', COMMON_INFO], 'fieldsLimit'],
  },
  {
    name: 'subsequent chunks are ignored after reaching the field limit',
    source: 'foo=bar&baz=bla|bla&x=y',
    options: { limits: { fields: 1 } },
    expected: [['foo', 'bar', COMMON_INFO], 'fieldsLimit'],
  },
  {
    name: 'fieldSize limit',
    source: 'a&b=&c=ab&d=abc&e=abcd&long=ab&percent=%25%25%25%25&plus=++++',
    options: { limits: { fieldSize: 2 } },
    expected: [
      ['a', '', COMMON_INFO],
      ['b', '', COMMON_INFO],
      ['c', 'ab', COMMON_INFO],
      ['d', 'ab', { ...COMMON_INFO, valueTruncated: true }],
      ['e', 'ab', { ...COMMON_INFO, valueTruncated: true }],
      ['long', 'ab', COMMON_INFO],
      ['percent', '%%', { ...COMMON_INFO, valueTruncated: true }],
      ['plus', '  ', { ...COMMON_INFO, valueTruncated: true }],
    ],
  },
  {
    name: 'fieldNameSize limit',
    source: '=baz&ab=baz&abc=baz&abcd=baz&also&cd=bazar&%25%25%25%25&++++',
    options: { limits: { fieldNameSize: 2 } },
    expected: [
      ['', 'baz', COMMON_INFO],
      ['ab', 'baz', COMMON_INFO],
      ['ab', 'baz', { ...COMMON_INFO, nameTruncated: true }],
      ['ab', 'baz', { ...COMMON_INFO, nameTruncated: true }],
      ['al', '', { ...COMMON_INFO, nameTruncated: true }],
      ['cd', 'bazar', COMMON_INFO],
      ['%%', '', { ...COMMON_INFO, nameTruncated: true }],
      ['  ', '', { ...COMMON_INFO, nameTruncated: true }],
    ],
  },
  {
    name: 'fieldSize=0',
    source: 'a=foo&b&c=&=bar&=',
    options: { limits: { fieldSize: 0 } },
    expected: [
      ['a', '', { ...COMMON_INFO, valueTruncated: true }],
      ['b', '', COMMON_INFO],
      ['c', '', COMMON_INFO],
      ['', '', { ...COMMON_INFO, valueTruncated: true }],
      ['', '', COMMON_INFO],
    ],
  },
  {
    name: 'fieldNameSize=0',
    source: 'a=foo&b&c=&=bar&=',
    options: { limits: { fieldNameSize: 0 } },
    expected: [
      ['', 'foo', { ...COMMON_INFO, nameTruncated: true }],
      ['', '', { ...COMMON_INFO, nameTruncated: true }],
      ['', '', { ...COMMON_INFO, nameTruncated: true }],
      ['', 'bar', COMMON_INFO],
      ['', '', COMMON_INFO],
    ],
  },
  {
    name: 'fieldSize=0, fieldNameSize=0',
    source: 'a=foo&b&c=&=bar&=',
    options: { limits: { fieldNameSize: 0, fieldSize: 0 } },
    expected: [
      ['', '', { ...COMMON_INFO, nameTruncated: true, valueTruncated: true }],
      ['', '', { ...COMMON_INFO, nameTruncated: true }],
      ['', '', { ...COMMON_INFO, nameTruncated: true }],
      ['', '', { ...COMMON_INFO, valueTruncated: true }],
      ['', '', COMMON_INFO],
    ],
  },
];

interface TestDef {
  name: string;
  source?: string;
  charset?: string;
  options?: BusboyOptions;
  expected: unknown[];
}

describe('urlencoded', () => {
  it(
    'reads URL encoded content',
    { parameters: tests },
    async ({ name, source = name, expected, options, charset = 'utf-8' }: any) => {
      const results = await new Promise<unknown[]>((resolve, reject) => {
        const results: unknown[] = [];
        const bb = busboy(
          { 'content-type': `application/x-www-form-urlencoded; charset=${charset}` },
          options,
        );

        bb.on('field', (key, val, info) => results.push([key, val, info]));
        bb.on('file', () => reject(new Error('Unexpected file')));
        bb.on('error', (err) => results.push({ error: err.message }));
        bb.on('partsLimit', () => results.push('partsLimit'));
        bb.on('filesLimit', () => results.push('filesLimit'));
        bb.on('fieldsLimit', () => results.push('fieldsLimit'));
        bb.on('close', () => resolve(results));

        for (const src of source.split('|')) {
          bb.write(typeof src === 'string' ? Buffer.from(src, 'utf-8') : src);
        }
        bb.end();
      });
      expect(results).equals(expected);
    },
  );

  it(
    'works when given one byte at a time',
    { parameters: tests },
    async ({ name, source = name, expected, options, charset = 'utf-8' }: any) => {
      const results = await new Promise<unknown[]>((resolve, reject) => {
        const results: unknown[] = [];
        const bb = busboy(
          { 'content-type': `application/x-www-form-urlencoded; charset=${charset}` },
          options,
        );

        bb.on('field', (key, val, info) => results.push([key, val, info]));
        bb.on('file', () => reject(new Error('Unexpected file')));
        bb.on('error', (err) => results.push({ error: err.message }));
        bb.on('partsLimit', () => results.push('partsLimit'));
        bb.on('filesLimit', () => results.push('filesLimit'));
        bb.on('fieldsLimit', () => results.push('fieldsLimit'));
        bb.on('close', () => resolve(results));

        for (const src of source.split('|')) {
          const buf = typeof src === 'string' ? Buffer.from(src, 'utf-8') : src;
          for (let i = 0; i < buf.length; ++i) {
            bb.write(buf.subarray(i, i + 1));
          }
        }
        bb.end();
      });
      expect(results).equals(expected);
    },
  );
});

function percentEncode(content: string, encoding: BufferEncoding): string {
  return [...Buffer.from(content, encoding)]
    .map((n) => `%${n.toString(16).padStart(2, '0')}`)
    .join('');
}
