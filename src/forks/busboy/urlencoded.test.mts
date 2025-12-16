import { Readable } from 'node:stream';
import { byteChunks, chunks } from '../../test-helpers/chunks.mts';
import type { BusboyOptions, FormField } from './types.mts';
import { busboy } from './busboy.mts';
import 'lean-test';

const COMMON: Partial<FormField> = {
  type: 'string',
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
    expected: [{ error: 'too many fields' }],
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
    expected: [{ ...COMMON, name: 'foo', value: 'bar' }, { error: 'too many fields' }],
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
      { error: 'too many fields' },
    ],
  },
  {
    name: 'subsequent chunks are ignored after reaching the field limit',
    source: 'foo=bar&baz=bla|bla&x=y',
    options: { limits: { fields: 1 } },
    expected: [{ ...COMMON, name: 'foo', value: 'bar' }, { error: 'too many fields' }],
  },
  {
    name: 'fieldSize limit',
    source: 'a&b=&c=ab&long=a&d=abc&e=abcd',
    options: { limits: { fieldSize: 2 } },
    expected: [
      { ...COMMON, name: 'a', value: '' },
      { ...COMMON, name: 'b', value: '' },
      { ...COMMON, name: 'c', value: 'ab' },
      { ...COMMON, name: 'long', value: 'a' },
      { error: 'value for "d" too long' },
    ],
  },
  {
    name: 'fieldSize limit (percent encoding)',
    source: 'p1=%25%25&percent=%25%25%25%25',
    options: { limits: { fieldSize: 2 } },
    expected: [{ ...COMMON, name: 'p1', value: '%%' }, { error: 'value for "percent" too long' }],
  },
  {
    name: 'fieldSize limit (plus)',
    source: 'p1=++&plus=++++',
    options: { limits: { fieldSize: 2 } },
    expected: [{ ...COMMON, name: 'p1', value: '  ' }, { error: 'value for "plus" too long' }],
  },
  {
    name: 'fieldNameSize limit',
    source: '=baz&ab=baz&abc=baz&abcd=baz',
    options: { limits: { fieldNameSize: 2 } },
    expected: [
      { ...COMMON, name: '', value: 'baz' },
      { ...COMMON, name: 'ab', value: 'baz' },
      { error: 'field name "ab"... too long' },
    ],
  },
  {
    name: 'fieldNameSize limit (no value)',
    source: 'long',
    options: { limits: { fieldNameSize: 2 } },
    expected: [{ error: 'field name "lo"... too long' }],
  },
  {
    name: 'fieldNameSize limit (percent encoding)',
    source: '%25%25=fine&%25%25%25%25',
    options: { limits: { fieldNameSize: 2 } },
    expected: [{ ...COMMON, name: '%%', value: 'fine' }, { error: 'field name "%%"... too long' }],
  },
  {
    name: 'fieldNameSize limit (plus)',
    source: '++=fine&++++',
    options: { limits: { fieldNameSize: 2 } },
    expected: [{ ...COMMON, name: '  ', value: 'fine' }, { error: 'field name "  "... too long' }],
  },
  {
    name: 'fieldSize=0',
    source: '=&a&b=&c=.',
    options: { limits: { fieldSize: 0 } },
    expected: [
      { ...COMMON, name: '', value: '' },
      { ...COMMON, name: 'a', value: '' },
      { ...COMMON, name: 'b', value: '' },
      { error: 'value for "c" too long' },
    ],
  },
  {
    name: 'fieldNameSize=0',
    source: '=&=bar&a&b=.',
    options: { limits: { fieldNameSize: 0 } },
    expected: [
      { ...COMMON, name: '', value: '' },
      { ...COMMON, name: '', value: 'bar' },
      { error: 'field name ""... too long' },
    ],
  },
  {
    name: 'fieldSize=0, fieldNameSize=0',
    source: '=&a=b',
    options: { limits: { fieldNameSize: 0, fieldSize: 0 } },
    expected: [{ ...COMMON, name: '', value: '' }, { error: 'field name ""... too long' }],
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
      const bb = busboy(
        { 'content-type': `application/x-www-form-urlencoded; charset=${charset}` },
        options,
      );

      const results: unknown[] = [];
      try {
        await bb(Readable.from(chunks(source)), (field) => results.push(field));
      } catch (error) {
        results.push({ error: error instanceof Error ? error.message : `raw error: ${error}` });
      }
      expect(results).equals(expected);
    },
  );

  it(
    'works when given one byte at a time',
    { parameters: tests },
    async ({ name, source = name, expected, options, charset = 'utf-8' }: any) => {
      const bb = busboy(
        { 'content-type': `application/x-www-form-urlencoded; charset=${charset}` },
        options,
      );

      const results: unknown[] = [];
      try {
        await bb(Readable.from(byteChunks(source.split('|'))), (field) => results.push(field));
      } catch (error) {
        results.push({ error: error instanceof Error ? error.message : `raw error: ${error}` });
      }
      expect(results).equals(expected);
    },
  );
});

function percentEncode(content: string, encoding: BufferEncoding): string {
  return [...Buffer.from(content, encoding)]
    .map((n) => `%${n.toString(16).padStart(2, '0')}`)
    .join('');
}
