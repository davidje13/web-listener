import type { BusboyOptions, FieldData } from './types.mts';
import { busboy } from './busboy.mts';
import 'lean-test';

const COMMON: Partial<FieldData> = {
  _nameTruncated: false,
  type: 'string',
  _valueTruncated: false,
  encoding: 'utf-8',
  mimeType: 'text/plain',
};

const tests: TestDef[] = [
  // simple keys and values
  { name: 'foo', expected: [{ ...COMMON, name: 'foo', value: '' }] },
  { name: 'foo=bar', expected: [{ ...COMMON, name: 'foo', value: 'bar' }] },
  { name: 'foo=', expected: [{ ...COMMON, name: 'foo', value: '' }] },
  { name: '=bar', expected: [{ ...COMMON, name: '', value: 'bar' }] },
  { name: '=', expected: [{ ...COMMON, name: '', value: '' }] },
  {
    name: 'foo&bar=baz',
    expected: [
      { ...COMMON, name: 'foo', value: '' },
      { ...COMMON, name: 'bar', value: 'baz' },
    ],
  },
  {
    name: 'foo=bar&baz',
    expected: [
      { ...COMMON, name: 'foo', value: 'bar' },
      { ...COMMON, name: 'baz', value: '' },
    ],
  },
  {
    name: 'foo=bar&baz=bla',
    expected: [
      { ...COMMON, name: 'foo', value: 'bar' },
      { ...COMMON, name: 'baz', value: 'bla' },
    ],
  },
  {
    name: 'foo&bar',
    expected: [
      { ...COMMON, name: 'foo', value: '' },
      { ...COMMON, name: 'bar', value: '' },
    ],
  },
  {
    name: 'foo&bar&',
    expected: [
      { ...COMMON, name: 'foo', value: '' },
      { ...COMMON, name: 'bar', value: '' },
    ],
  },
  {
    name: '=&baz',
    expected: [
      { ...COMMON, name: '', value: '' },
      { ...COMMON, name: 'baz', value: '' },
    ],
  },
  {
    name: '=bar&baz',
    expected: [
      { ...COMMON, name: '', value: 'bar' },
      { ...COMMON, name: 'baz', value: '' },
    ],
  },
  {
    name: 'foo=&baz',
    expected: [
      { ...COMMON, name: 'foo', value: '' },
      { ...COMMON, name: 'baz', value: '' },
    ],
  },

  // blank fields
  { name: 'blank', source: '', expected: [] },
  { name: '&', expected: [] },
  { name: '&&&&&', expected: [] },
  { name: '&&foo=bar&&', expected: [{ ...COMMON, name: 'foo', value: 'bar' }] },

  // character escapes
  {
    name: 'encoded bytes',
    source: 'foo%20bar=baz%20bla%21',
    expected: [{ ...COMMON, name: 'foo bar', value: 'baz bla!' }],
  },
  {
    name: 'plus maps to space',
    source: 'foo+1=bar+baz%2Bquux',
    expected: [{ ...COMMON, name: 'foo 1', value: 'bar baz+quux' }],
  },
  {
    name: 'foo=bar%20%21&num=1000',
    expected: [
      { ...COMMON, name: 'foo', value: 'bar !' },
      { ...COMMON, name: 'num', value: '1000' },
    ],
  },
  {
    name: 'unencoded equals symbol',
    source: 'foo=bar=baz',
    expected: [{ ...COMMON, name: 'foo', value: 'bar=baz' }],
  },

  // character sets
  {
    name: 'multi-byte charset',
    charset: 'UTF-16LE',
    source: `${percentEncode('foo', 'utf-16le')}=${percentEncode('😀!', 'utf-16le')}`,
    expected: [{ ...COMMON, name: 'foo', value: '😀!', encoding: 'UTF-16LE' }],
  },
  {
    name: 'single-byte, ASCII-compatible, non-UTF-8 charset',
    charset: 'ISO-8859-1',
    source: `foo=<${percentEncode('©:^þ', 'latin1')}`,
    expected: [{ ...COMMON, name: 'foo', value: '<©:^þ', encoding: 'ISO-8859-1' }],
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
    expected: [{ ...COMMON, name: 'foo', value: 'bar' }],
  },
  {
    name: 'fields=1 exceeded',
    source: 'foo=bar&baz=bla',
    options: { limits: { fields: 1 } },
    expected: [{ ...COMMON, name: 'foo', value: 'bar' }, 'fieldsLimit'],
  },
  {
    name: 'fields=2 reached',
    source: 'foo=bar&baz=bla',
    options: { limits: { fields: 2 } },
    expected: [
      { ...COMMON, name: 'foo', value: 'bar' },
      { ...COMMON, name: 'baz', value: 'bla' },
    ],
  },
  {
    name: 'fields=2 exceeded',
    source: 'foo=bar&baz=bla&more',
    options: { limits: { fields: 2 } },
    expected: [
      { ...COMMON, name: 'foo', value: 'bar' },
      { ...COMMON, name: 'baz', value: 'bla' },
      'fieldsLimit',
    ],
  },
  {
    name: 'subsequent chunks are ignored after reaching the field limit',
    source: 'foo=bar&baz=bla|bla&x=y',
    options: { limits: { fields: 1 } },
    expected: [{ ...COMMON, name: 'foo', value: 'bar' }, 'fieldsLimit'],
  },
  {
    name: 'fieldSize limit',
    source: 'a&b=&c=ab&d=abc&e=abcd&long=ab&percent=%25%25%25%25&plus=++++',
    options: { limits: { fieldSize: 2 } },
    expected: [
      { ...COMMON, name: 'a', value: '' },
      { ...COMMON, name: 'b', value: '' },
      { ...COMMON, name: 'c', value: 'ab' },
      { ...COMMON, name: 'd', value: 'ab', _valueTruncated: true },
      { ...COMMON, name: 'e', value: 'ab', _valueTruncated: true },
      { ...COMMON, name: 'long', value: 'ab' },
      { ...COMMON, name: 'percent', value: '%%', _valueTruncated: true },
      { ...COMMON, name: 'plus', value: '  ', _valueTruncated: true },
    ],
  },
  {
    name: 'fieldNameSize limit',
    source: '=baz&ab=baz&abc=baz&abcd=baz&also&cd=bazar&%25%25%25%25&++++',
    options: { limits: { fieldNameSize: 2 } },
    expected: [
      { ...COMMON, name: '', value: 'baz' },
      { ...COMMON, name: 'ab', value: 'baz' },
      { ...COMMON, name: 'ab', value: 'baz', _nameTruncated: true },
      { ...COMMON, name: 'ab', value: 'baz', _nameTruncated: true },
      { ...COMMON, name: 'al', value: '', _nameTruncated: true },
      { ...COMMON, name: 'cd', value: 'bazar' },
      { ...COMMON, name: '%%', value: '', _nameTruncated: true },
      { ...COMMON, name: '  ', value: '', _nameTruncated: true },
    ],
  },
  {
    name: 'fieldSize=0',
    source: 'a=foo&b&c=&=bar&=',
    options: { limits: { fieldSize: 0 } },
    expected: [
      { ...COMMON, name: 'a', value: '', _valueTruncated: true },
      { ...COMMON, name: 'b', value: '' },
      { ...COMMON, name: 'c', value: '' },
      { ...COMMON, name: '', value: '', _valueTruncated: true },
      { ...COMMON, name: '', value: '' },
    ],
  },
  {
    name: 'fieldNameSize=0',
    source: 'a=foo&b&c=&=bar&=',
    options: { limits: { fieldNameSize: 0 } },
    expected: [
      { ...COMMON, name: '', value: 'foo', _nameTruncated: true },
      { ...COMMON, name: '', value: '', _nameTruncated: true },
      { ...COMMON, name: '', value: '', _nameTruncated: true },
      { ...COMMON, name: '', value: 'bar' },
      { ...COMMON, name: '', value: '' },
    ],
  },
  {
    name: 'fieldSize=0, fieldNameSize=0',
    source: 'a=foo&b&c=&=bar&=',
    options: { limits: { fieldNameSize: 0, fieldSize: 0 } },
    expected: [
      { ...COMMON, name: '', value: '', _nameTruncated: true, _valueTruncated: true },
      { ...COMMON, name: '', value: '', _nameTruncated: true },
      { ...COMMON, name: '', value: '', _nameTruncated: true },
      { ...COMMON, name: '', value: '', _valueTruncated: true },
      { ...COMMON, name: '', value: '' },
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
      const results = await new Promise<unknown[]>((resolve) => {
        const results: unknown[] = [];
        const bb = busboy(
          { 'content-type': `application/x-www-form-urlencoded; charset=${charset}` },
          options,
        );

        bb.on('field', (data) => results.push(data));
        bb.on('error', (error) => results.push({ error: error.message }));
        bb.on('limit', (type) => results.push(type + 'Limit'));
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
      const results = await new Promise<unknown[]>((resolve) => {
        const results: unknown[] = [];
        const bb = busboy(
          { 'content-type': `application/x-www-form-urlencoded; charset=${charset}` },
          options,
        );

        bb.on('field', (data) => results.push(data));
        bb.on('error', (error) => results.push({ error: error.message }));
        bb.on('limit', (type) => results.push(type + 'Limit'));
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
