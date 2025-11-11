import type { BusboyOptions } from './types.mts';
import { busboy } from './busboy.mts';
import 'lean-test';

const COMMON_INFO = {
  nameTruncated: false,
  valueTruncated: false,
  encoding: 'utf-8',
  mimeType: 'text/plain',
};

interface TestDef {
  name: string;
  charset?: string;
  source: string[];
  options?: BusboyOptions;
  expected: unknown[];
}

const tests: TestDef[] = [
  {
    name: 'Unassigned value',
    source: ['foo'],
    expected: [['foo', '', COMMON_INFO]],
  },
  {
    name: 'Assigned value',
    source: ['foo=bar'],
    expected: [['foo', 'bar', COMMON_INFO]],
  },
  {
    name: 'Value with unencoded equals symbol',
    source: ['foo=bar=baz'],
    expected: [['foo', 'bar=baz', COMMON_INFO]],
  },
  {
    name: 'Unassigned and assigned value',
    source: ['foo&bar=baz'],
    expected: [
      ['foo', '', COMMON_INFO],
      ['bar', 'baz', COMMON_INFO],
    ],
  },
  {
    name: 'Assigned and unassigned value',
    source: ['foo=bar&baz'],
    expected: [
      ['foo', 'bar', COMMON_INFO],
      ['baz', '', COMMON_INFO],
    ],
  },
  {
    name: 'Two assigned values',
    source: ['foo=bar&baz=bla'],
    expected: [
      ['foo', 'bar', COMMON_INFO],
      ['baz', 'bla', COMMON_INFO],
    ],
  },
  {
    name: 'Two unassigned values',
    source: ['foo&bar'],
    expected: [
      ['foo', '', COMMON_INFO],
      ['bar', '', COMMON_INFO],
    ],
  },
  {
    name: 'Two unassigned values and ampersand',
    source: ['foo&bar&'],
    expected: [
      ['foo', '', COMMON_INFO],
      ['bar', '', COMMON_INFO],
    ],
  },
  {
    name: 'Assigned key and value with (plus) space',
    source: ['foo+1=bar+baz%2Bquux'],
    expected: [['foo 1', 'bar baz+quux', COMMON_INFO]],
  },
  {
    name: 'Assigned value with encoded bytes',
    source: ['foo=bar%20baz%21'],
    expected: [['foo', 'bar baz!', COMMON_INFO]],
  },
  {
    name: 'Assigned value with encoded bytes #2',
    source: ['foo%20bar=baz%20bla%21'],
    expected: [['foo bar', 'baz bla!', COMMON_INFO]],
  },
  {
    name: 'Two assigned values, one with encoded bytes',
    source: ['foo=bar%20baz%21&num=1000'],
    expected: [
      ['foo', 'bar baz!', COMMON_INFO],
      ['num', '1000', COMMON_INFO],
    ],
  },
  {
    name: 'Encoded value with multi-byte charset',
    charset: 'UTF-16LE',
    source: [
      percentEncode(Buffer.from('foo', 'utf-16le')),
      '=',
      percentEncode(Buffer.from('😀!', 'utf-16le')),
    ],
    expected: [['foo', '😀!', { ...COMMON_INFO, encoding: 'UTF-16LE' }]],
  },
  {
    name: 'Encoded value with single-byte, ASCII-compatible, non-UTF8 charset',
    charset: 'ISO-8859-1',
    source: ['foo=<', percentEncode(Buffer.from('©:^þ', 'latin1'))],
    expected: [['foo', '<©:^þ', { ...COMMON_INFO, encoding: 'ISO-8859-1' }]],
  },
  {
    name: 'Limits: zero fields',
    source: ['foo=bar&baz=bla'],
    options: { limits: { fields: 0 } },
    expected: [],
  },
  {
    name: 'Limits: one field',
    source: ['foo=bar&baz=bla'],
    options: { limits: { fields: 1 } },
    expected: [['foo', 'bar', COMMON_INFO]],
  },
  {
    name: 'Limits: one field with multiple batches',
    source: ['foo=bar&baz=bla', '&x=y'],
    options: { limits: { fields: 1 } },
    expected: [['foo', 'bar', COMMON_INFO]],
  },
  {
    name: 'Limits: field part lengths match limits',
    source: ['foo=bar&baz=bla'],
    options: { limits: { fieldNameSize: 3, fieldSize: 3 } },
    expected: [
      ['foo', 'bar', COMMON_INFO],
      ['baz', 'bla', COMMON_INFO],
    ],
  },
  {
    name: 'Limits: truncated field name',
    source: ['foo=bar&baz=bla'],
    options: { limits: { fieldNameSize: 2 } },
    expected: [
      ['fo', 'bar', { ...COMMON_INFO, nameTruncated: true }],
      ['ba', 'bla', { ...COMMON_INFO, nameTruncated: true }],
    ],
  },
  {
    name: 'Limits: truncated field value',
    source: ['foo=bar&baz=bla'],
    options: { limits: { fieldSize: 2 } },
    expected: [
      ['foo', 'ba', { ...COMMON_INFO, valueTruncated: true }],
      ['baz', 'bl', { ...COMMON_INFO, valueTruncated: true }],
    ],
  },
  {
    name: 'Limits: truncated field value with percent encoding',
    source: ['foo=%25%25%25'],
    options: { limits: { fieldSize: 2 } },
    expected: [['foo', '%%', { ...COMMON_INFO, valueTruncated: true }]],
  },
  {
    name: 'Limits: truncated field value with encoded spaces',
    source: ['foo=+++'],
    options: { limits: { fieldSize: 2 } },
    expected: [['foo', '  ', { ...COMMON_INFO, valueTruncated: true }]],
  },
  {
    name: 'Limits: truncated field name and value',
    source: ['foo=bar&baz=bla'],
    options: { limits: { fieldNameSize: 2, fieldSize: 2 } },
    expected: [
      ['fo', 'ba', { ...COMMON_INFO, nameTruncated: true, valueTruncated: true }],
      ['ba', 'bl', { ...COMMON_INFO, nameTruncated: true, valueTruncated: true }],
    ],
  },
  {
    name: 'Limits: truncated field name and zero value limit',
    source: ['foo=bar&baz=bla'],
    options: { limits: { fieldNameSize: 2, fieldSize: 0 } },
    expected: [
      ['fo', '', { ...COMMON_INFO, nameTruncated: true, valueTruncated: true }],
      ['ba', '', { ...COMMON_INFO, nameTruncated: true, valueTruncated: true }],
    ],
  },
  {
    name: 'Limits: truncated zero field name and zero value limit',
    source: ['foo=bar&baz=bla'],
    options: { limits: { fieldNameSize: 0, fieldSize: 0 } },
    expected: [
      ['', '', { ...COMMON_INFO, nameTruncated: true, valueTruncated: true }],
      ['', '', { ...COMMON_INFO, nameTruncated: true, valueTruncated: true }],
    ],
  },
  {
    name: 'Ampersand',
    source: ['&'],
    expected: [],
  },
  {
    name: 'Many ampersands',
    source: ['&&&&&'],
    expected: [],
  },
  {
    name: 'Assigned value, empty name and value, not last',
    source: ['=&a=b'],
    expected: [
      ['', '', COMMON_INFO],
      ['a', 'b', COMMON_INFO],
    ],
  },
  {
    name: 'Empty key, not last',
    source: ['=foo&a=b'],
    expected: [
      ['', 'foo', COMMON_INFO],
      ['a', 'b', COMMON_INFO],
    ],
  },
  {
    name: 'Empty value, not last',
    source: ['foo=&a=b'],
    expected: [
      ['foo', '', COMMON_INFO],
      ['a', 'b', COMMON_INFO],
    ],
  },
  {
    name: 'Assigned value, empty name and value, last',
    source: ['='],
    expected: [['', '', COMMON_INFO]],
  },
  {
    name: 'Empty key, last',
    source: ['=foo'],
    expected: [['', 'foo', COMMON_INFO]],
  },
  {
    name: 'Empty value, last',
    source: ['foo='],
    expected: [['foo', '', COMMON_INFO]],
  },
  {
    name: 'Nothing',
    source: [''],
    expected: [],
  },
];

describe('urlencoded', () => {
  it(
    'reads URL encoded content',
    { parameters: tests },
    async ({ source, expected, options, charset = 'utf-8' }: any) => {
      const results = await new Promise<unknown[]>((resolve, reject) => {
        const results: unknown[] = [];
        const bb = busboy(
          { 'content-type': `application/x-www-form-urlencoded; charset=${charset}` },
          options,
        );

        bb.on('field', (key, val, info) => results.push([key, val, info]));
        bb.on('file', () => reject(new Error('Unexpected file')));
        bb.on('close', () => resolve(results));

        for (const src of source) {
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
    async ({ source, expected, options, charset = 'utf-8' }: any) => {
      const results = await new Promise<unknown[]>((resolve, reject) => {
        const results: unknown[] = [];
        const bb = busboy(
          { 'content-type': `application/x-www-form-urlencoded; charset=${charset}` },
          options,
        );

        bb.on('field', (key, val, info) => results.push([key, val, info]));
        bb.on('file', () => reject(new Error('Unexpected file')));
        bb.on('close', () => resolve(results));

        for (const src of source) {
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

function percentEncode(content: Buffer): string {
  return [...content].map((n) => `%${n.toString(16).padStart(2, '0')}`).join('');
}
