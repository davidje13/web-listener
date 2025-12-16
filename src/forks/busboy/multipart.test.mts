import { randomFillSync } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { BusboyInstance, BusboyOptions, FieldData } from './types.mts';
import { busboy } from './busboy.mts';
import 'lean-test';

const COMMON_FILE = {
  _nameTruncated: false,
  type: 'file',
  encoding: '7bit',
  mimeType: 'application/octet-stream',
  limited: false,
  truncated: false,
  err: undefined,
};

const COMMON_FIELD: Partial<FieldData> = {
  _nameTruncated: false,
  type: 'string',
  _valueTruncated: false,
  encoding: '7bit',
  mimeType: 'text/plain',
};

interface TestDef {
  name: string;
  source: (string[] | Buffer)[];
  boundary: string;
  options?: BusboyOptions;
  expected: unknown[];
}

const COMMON_BOUNDARY = '---------------------------paZqsnEHRufoShdX6fh0lUhXBP4k';

const tests: TestDef[] = [
  {
    name: 'Fields and files',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="file_name_0"',
        '',
        'super alpha file',
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="file_name_1"',
        '',
        'super beta file',
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_0"; filename="1k_a.dat"',
        'Content-Type: application/octet-stream',
        '',
        'A'.repeat(1023),
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_1"; filename="1k_b.dat"',
        'Content-Type: application/octet-stream',
        '',
        'B'.repeat(1023),
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [
      { ...COMMON_FIELD, name: 'file_name_0', value: 'super alpha file' },
      { ...COMMON_FIELD, name: 'file_name_1', value: 'super beta file' },
      {
        ...COMMON_FILE,
        name: 'upload_file_0',
        data: Buffer.from('A'.repeat(1023)),
        filename: '1k_a.dat',
      },
      {
        ...COMMON_FILE,
        name: 'upload_file_1',
        data: Buffer.from('B'.repeat(1023)),
        filename: '1k_b.dat',
      },
    ],
  },
  {
    name: 'Fields only',
    source: [
      [
        '------WebKitFormBoundaryTB2MiQ36fnSJlrhY',
        'Content-Disposition: form-data; name="cont"',
        '',
        'some random content',
        '------WebKitFormBoundaryTB2MiQ36fnSJlrhY',
        'Content-Disposition: form-data; name="pass"',
        '',
        'some random pass',
        '------WebKitFormBoundaryTB2MiQ36fnSJlrhY',
        'Content-Disposition: form-data; name=bit',
        '',
        '2',
        '------WebKitFormBoundaryTB2MiQ36fnSJlrhY--',
      ],
    ],
    boundary: '----WebKitFormBoundaryTB2MiQ36fnSJlrhY',
    expected: [
      { ...COMMON_FIELD, name: 'cont', value: 'some random content' },
      { ...COMMON_FIELD, name: 'pass', value: 'some random pass' },
      { ...COMMON_FIELD, name: 'bit', value: '2' },
    ],
  },
  {
    name: 'No fields and no files',
    source: [[]],
    boundary: '----WebKitFormBoundaryTB2MiQ36fnSJlrhY',
    expected: [{ error: 'unexpected end of form' }],
  },
  {
    name: 'Blank field name',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name=""',
        '',
        'content',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [{ ...COMMON_FIELD, name: '', value: 'content' }],
  },
  {
    name: 'Missing field name',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data',
        '',
        'content',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [{ warn: 'missing field name' }],
  },
  {
    name: 'Fields and files (limits)',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="file_name_0"',
        '',
        'super alpha file',
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_0"; filename="1k_a.dat"',
        'Content-Type: application/octet-stream',
        '',
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    options: { limits: { fileSize: 13, fieldSize: 5 } },
    expected: [
      { ...COMMON_FIELD, name: 'file_name_0', value: 'super', _valueTruncated: true },
      {
        ...COMMON_FILE,
        name: 'upload_file_0',
        data: Buffer.from('ABCDEFGHIJKLM'),
        filename: '1k_a.dat',
        limited: true,
        truncated: true,
      },
    ],
  },
  {
    name: 'Fields and files (at limit)',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="file_name_0"',
        '',
        'super',
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_0"; filename="1k_a.dat"',
        'Content-Type: application/octet-stream',
        '',
        'ABCDEFGHIJKLM',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    options: { limits: { fileSize: 13, fieldSize: 5 } },
    expected: [
      { ...COMMON_FIELD, name: 'file_name_0', value: 'super' },
      {
        ...COMMON_FILE,
        name: 'upload_file_0',
        data: Buffer.from('ABCDEFGHIJKLM'),
        filename: '1k_a.dat',
      },
    ],
  },
  {
    name: 'Fields and files (limits: 0 files)',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="file_name_0"',
        '',
        'super alpha file',
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_0"; filename="1k_a.dat"',
        'Content-Type: application/octet-stream',
        '',
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    options: { limits: { files: 0 } },
    expected: [{ ...COMMON_FIELD, name: 'file_name_0', value: 'super alpha file' }, 'filesLimit'],
  },
  {
    name: 'Files with filenames containing paths',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_0"; filename="/tmp/1k_a.dat"',
        'Content-Type: application/octet-stream',
        '',
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_1"; filename="C:\\files\\1k_b.dat"',
        'Content-Type: application/octet-stream',
        '',
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_2"; filename="relative/1k_c.dat"',
        'Content-Type: application/octet-stream',
        '',
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [
      {
        ...COMMON_FILE,
        name: 'upload_file_0',
        data: Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
        filename: '1k_a.dat',
      },
      {
        ...COMMON_FILE,
        name: 'upload_file_1',
        data: Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
        filename: '1k_b.dat',
      },
      {
        ...COMMON_FILE,
        name: 'upload_file_2',
        data: Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
        filename: '1k_c.dat',
      },
    ],
  },
  {
    name: 'Paths to be preserved through the preservePath option',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_0"; filename="/absolute/1k_a.dat"',
        'Content-Type: application/octet-stream',
        '',
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; ' +
          'name="upload_file_1"; filename="C:\\absolute\\1k_b.dat"',
        'Content-Type: application/octet-stream',
        '',
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_2"; filename="relative/1k_c.dat"',
        'Content-Type: application/octet-stream',
        '',
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    options: { preservePath: true },
    expected: [
      {
        ...COMMON_FILE,
        name: 'upload_file_0',
        data: Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
        filename: '/absolute/1k_a.dat',
      },
      {
        ...COMMON_FILE,
        name: 'upload_file_1',
        data: Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
        filename: 'C:\\absolute\\1k_b.dat',
      },
      {
        ...COMMON_FILE,
        name: 'upload_file_2',
        data: Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
        filename: 'relative/1k_c.dat',
      },
    ],
  },
  {
    name: 'Empty content-type and empty content-disposition',
    source: [
      [
        '------WebKitFormBoundaryTB2MiQ36fnSJlrhY',
        'Content-Disposition: form-data; name="cont"',
        'Content-Type: ',
        '',
        'some random content',
        '------WebKitFormBoundaryTB2MiQ36fnSJlrhY',
        'Content-Disposition: ',
        '',
        'some random pass',
        '------WebKitFormBoundaryTB2MiQ36fnSJlrhY--',
      ],
    ],
    boundary: '----WebKitFormBoundaryTB2MiQ36fnSJlrhY',
    expected: [{ ...COMMON_FIELD, name: 'cont', value: 'some random content' }],
  },
  {
    name: 'Custom filename* character set',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="file"; filename*=utf-8\'\'n%C3%A4me.txt',
        'Content-Type: application/octet-stream',
        '',
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [
      {
        ...COMMON_FILE,
        name: 'file',
        data: Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
        filename: 'näme.txt',
      },
    ],
  },
  {
    // these inputs are technically malformed, but in practice are typically utf-8
    // (this is the normal behaviour of Chrome & Firefox)
    name: 'Non-standard filenames interpreted as utf-8 by default',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="file"; filename="テスト.dat"',
        'Content-Type: application/octet-stream',
        '',
        '.',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [{ ...COMMON_FILE, name: 'file', data: Buffer.from('.'), filename: 'テスト.dat' }],
  },
  {
    // these inputs are technically malformed but this can come from a browser
    // submitting a form on a page with a particular charset set
    name: 'Filename configurable default encoding',
    source: [
      [`--${COMMON_BOUNDARY}`, 'Content-Disposition: form-data; name="upload_file_0"; filename="'],
      Buffer.from([0xb7, 0xb5]),
      ['"', 'Content-Type: application/octet-stream', '', '.', `--${COMMON_BOUNDARY}--`],
    ],
    boundary: COMMON_BOUNDARY,
    options: { defParamCharset: 'macintosh' },
    expected: [{ ...COMMON_FILE, name: 'upload_file_0', data: Buffer.from('.'), filename: '∑µ' }],
  },
  {
    name: 'Field with multibyte characters',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="f"',
        '',
        '\u2026',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [{ ...COMMON_FIELD, name: 'f', value: '\u2026' }],
  },
  {
    name: 'Invalid part header',
    source: [[`--${COMMON_BOUNDARY}`, ': oops', '', '', `--${COMMON_BOUNDARY}--`]],
    boundary: COMMON_BOUNDARY,
    expected: [{ warn: 'malformed part header' }],
  },
  {
    name: 'Stopped during a broken header',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Type: text/plain',
        'Content-Disposition: form-data; name="foo"',
        `:--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [{ warn: 'malformed part header' }, { error: 'unexpected end of form' }],
  },
  {
    name: 'Stopped before end of last headers',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Type: text/plain',
        'Content-Disposition: form-data; name="foo"',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [{ warn: 'unexpected end of headers' }],
  },
  {
    name: 'Stopped before end of headers',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Type: text/plain',
        'Content-Disposition: form-data; name="foo"',
        `--${COMMON_BOUNDARY}`,
        'Content-Type: text/plain',
        'Content-Disposition: form-data; name="bar"',
        '',
        '',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [{ warn: 'unexpected end of headers' }],
  },
  {
    name: 'content-type for fields',
    source: [
      [
        '------WebKitFormBoundaryTB2MiQ36fnSJlrhY',
        'Content-Disposition: form-data; name="cont"',
        'Content-Type: application/json',
        '',
        '{}',
        '------WebKitFormBoundaryTB2MiQ36fnSJlrhY--',
      ],
    ],
    boundary: '----WebKitFormBoundaryTB2MiQ36fnSJlrhY',
    expected: [{ ...COMMON_FIELD, name: 'cont', value: '{}', mimeType: 'application/json' }],
  },
  {
    name: 'empty form',
    source: [['------WebKitFormBoundaryTB2MiQ36fnSJlrhY--']],
    boundary: '----WebKitFormBoundaryTB2MiQ36fnSJlrhY',
    expected: [],
  },
  {
    name: 'Stopped mid-file #1',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name=upload_file_0; filename="1k_a.dat"',
        'Content-Type: application/octet-stream',
        'Content-Transfer-Encoding: binary',
        '',
        '',
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [
      {
        ...COMMON_FILE,
        name: 'upload_file_0',
        data: Buffer.alloc(0),
        filename: '1k_a.dat',
        encoding: 'binary',
        err: 'unexpected end of form',
      },
      { error: 'unexpected end of form' },
    ],
  },
  {
    name: 'Stopped mid-file #2',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name=upload_file_0; filename="1k_a.dat"',
        'Content-Type: application/octet-stream',
        '',
        'a',
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [
      {
        ...COMMON_FILE,
        name: 'upload_file_0',
        data: Buffer.from('a'),
        filename: '1k_a.dat',
        err: 'unexpected end of form',
      },
      { error: 'unexpected end of form' },
    ],
  },
  {
    name: 'Text file with charset',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_0"; filename="notes.txt"',
        'Content-Type: text/plain; charset=utf8',
        '',
        'a',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [
      {
        ...COMMON_FILE,
        name: 'upload_file_0',
        data: Buffer.from('a'),
        filename: 'notes.txt',
        mimeType: 'text/plain',
      },
    ],
  },
  {
    name: 'Folded header value',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_0"; filename="notes.txt"',
        'Content-Type: ',
        ' text/other; charset=utf8',
        '',
        'a',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [
      {
        ...COMMON_FILE,
        name: 'upload_file_0',
        data: Buffer.from('a'),
        filename: 'notes.txt',
        mimeType: 'text/other',
      },
    ],
  },
  {
    name: 'No Content-Disposition',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Type: text/plain; charset=utf8',
        '',
        'a',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [],
  },
  {
    name: 'Zero parts limit',
    source: [[`--${COMMON_BOUNDARY}--`]],
    boundary: COMMON_BOUNDARY,
    options: { limits: { parts: 0 } },
    expected: [],
  },
  {
    name: 'Zero parts limit exceeded',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="file_name_0"',
        '',
        'a',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    options: { limits: { parts: 0 } },
    expected: ['partsLimit'],
  },
  {
    name: 'Parts limit reached',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="file_name_0"',
        '',
        'a',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    options: { limits: { parts: 1 } },
    expected: [{ ...COMMON_FIELD, name: 'file_name_0', value: 'a' }],
  },
  {
    name: 'Parts limit exceeded',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="file_name_0"',
        '',
        'a',
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_0"; filename="notes.txt"',
        'Content-Type: ',
        ' text/plain; charset=utf8',
        '',
        'bc',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    options: { limits: { parts: 1 } },
    expected: [{ ...COMMON_FIELD, name: 'file_name_0', value: 'a' }, 'partsLimit'],
  },
  {
    name: 'Zero fields limit',
    source: [[`--${COMMON_BOUNDARY}--`]],
    boundary: COMMON_BOUNDARY,
    options: { limits: { fields: 0 } },
    expected: [],
  },
  {
    name: 'Zero fields limit exceeded',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="file_name_0"',
        '',
        'a',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    options: { limits: { fields: 0 } },
    expected: ['fieldsLimit'],
  },
  {
    name: 'Fields limit reached',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="file_name_0"',
        '',
        'a',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    options: { limits: { fields: 1 } },
    expected: [{ ...COMMON_FIELD, name: 'file_name_0', value: 'a' }],
  },
  {
    name: 'Fields limit exceeded',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="file_name_0"',
        '',
        'a',
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="file_name_1"',
        '',
        'b',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    options: { limits: { fields: 1 } },
    expected: [{ ...COMMON_FIELD, name: 'file_name_0', value: 'a' }, 'fieldsLimit'],
  },
  {
    name: 'Zero files limit',
    source: [[`--${COMMON_BOUNDARY}--`]],
    boundary: COMMON_BOUNDARY,
    options: { limits: { files: 0 } },
    expected: [],
  },
  {
    name: 'Zero files limit exceeded',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_0"; filename="notes.txt"',
        'Content-Type: text/plain; charset=utf8',
        '',
        'ab',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    options: { limits: { files: 0 } },
    expected: ['filesLimit'],
  },
  {
    name: 'Files limit reached',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_0"; filename="notes.txt"',
        'Content-Type: text/plain; charset=utf8',
        '',
        'ab',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    options: { limits: { files: 1 } },
    expected: [
      {
        ...COMMON_FILE,
        name: 'upload_file_0',
        data: Buffer.from('ab'),
        filename: 'notes.txt',
        mimeType: 'text/plain',
      },
    ],
  },
  {
    name: 'Files limit exceeded',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_0"; filename="notes.txt"',
        'Content-Type: text/plain; charset=utf8',
        '',
        'ab',
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_1"; filename="notes2.txt"',
        'Content-Type: text/plain; charset=utf8',
        '',
        'cd',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    options: { limits: { files: 1 } },
    expected: [
      {
        ...COMMON_FILE,
        name: 'upload_file_0',
        data: Buffer.from('ab'),
        filename: 'notes.txt',
        mimeType: 'text/plain',
      },
      'filesLimit',
    ],
  },
  {
    name: 'Oversized part header',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; ' +
          `name="upload_file_0"; filename="${'a'.repeat(64 * 1024)}.txt"`,
        'Content-Type: text/plain; charset=utf8',
        '',
        'ab',
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_1"; filename="notes2.txt"',
        'Content-Type: text/plain; charset=utf8',
        '',
        'cd',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [
      { warn: 'malformed part header' },
      {
        ...COMMON_FILE,
        name: 'upload_file_1',
        data: Buffer.from('cd'),
        filename: 'notes2.txt',
        mimeType: 'text/plain',
      },
    ],
  },
  {
    name: 'Field name limit (field)',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="long_field_name"',
        '',
        'a',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    options: { limits: { fieldNameSize: 4 } },
    expected: [{ ...COMMON_FIELD, name: 'long', value: 'a', _nameTruncated: true }],
  },
  {
    name: 'Field name limit (file)',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="long_field_name"; filename="foo.txt"',
        'Content-Type: application/octet-stream',
        '',
        'a',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    options: { limits: { fieldNameSize: 4 } },
    expected: [
      {
        ...COMMON_FILE,
        name: 'long',
        data: Buffer.from('a'),
        filename: 'foo.txt',
        _nameTruncated: true,
      },
    ],
  },
  {
    name: 'Lookbehind data should not stall file streams',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="upload_file_0"; filename="notes.txt"',
        'Content-Type: text/plain; charset=utf8',
        '',
        'a'.repeat(31) + '\r',
      ],
      ['b'.repeat(40)],
      [`\r\n--${COMMON_BOUNDARY}--`],
    ],
    boundary: COMMON_BOUNDARY,
    options: { fileHwm: 32 },
    expected: [
      {
        ...COMMON_FILE,
        name: 'upload_file_0',
        data: Buffer.from('a'.repeat(31) + '\r' + 'b'.repeat(40)),
        filename: 'notes.txt',
        mimeType: 'text/plain',
      },
    ],
  },
  {
    name: 'Fields after invalid boundaries are ignored',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="f1"',
        '',
        'a',
        `--${COMMON_BOUNDARY}-`, // partial final boundary
        'Content-Disposition: form-data; name="f2"',
        '',
        'b',
        `--${COMMON_BOUNDARY}\rContent-Disposition: form-data; name="f3"`, // partial separator boundary
        '',
        'c',
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="f4"',
        '',
        'd',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [
      { ...COMMON_FIELD, name: 'f1', value: 'a' },
      { ...COMMON_FIELD, name: 'f4', value: 'd' },
    ],
  },
  {
    name: 'Unknown header is ignored',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="f1"; filename="f.txt"',
        'Content-Type: application/octet-stream',
        'Foo: bar',
        '',
        'ab',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [{ ...COMMON_FILE, name: 'f1', data: Buffer.from('ab'), filename: 'f.txt' }],
  },
  {
    name: 'Duplicate content-type header is ignored',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="f1"; filename="f.txt"',
        'Content-Type: text/plain; charset=utf8',
        'Content-Type: other/thing; charset=latin1',
        '',
        'ab',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [
      {
        ...COMMON_FILE,
        name: 'f1',
        data: Buffer.from('ab'),
        mimeType: 'text/plain',
        filename: 'f.txt',
      },
    ],
  },
  {
    name: 'Duplicate content-disposition header is ignored',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="f1"; filename="f.txt"',
        'Content-Disposition: form-data; name="f2"; filename="f2.txt"',
        'Content-Type: application/octet-stream',
        '',
        'ab',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [{ ...COMMON_FILE, name: 'f1', data: Buffer.from('ab'), filename: 'f.txt' }],
  },
  {
    name: 'Duplicate content-transfer-encoding header is merged',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="f1"; filename="f.txt"',
        'Content-Type: application/octet-stream',
        'Content-Transfer-Encoding: a',
        'Content-Transfer-Encoding: b',
        '',
        'ab',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [
      { ...COMMON_FILE, name: 'f1', data: Buffer.from('ab'), filename: 'f.txt', encoding: 'a,b' },
    ],
  },
  {
    name: 'Header size limit should be per part',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; ' +
          `name="upload_file_0"; filename="${'a'.repeat(8 * 1024)}.txt"`,
        'Content-Type: text/plain; charset=utf8',
        '',
        'ab',
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; ' +
          `name="upload_file_1"; filename="${'b'.repeat(8 * 1024)}.txt"`,
        'Content-Type: text/plain; charset=utf8',
        '',
        'cd',
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; ' +
          `name="upload_file_2"; filename="${'c'.repeat(8 * 1024)}.txt"`,
        'Content-Type: text/plain; charset=utf8',
        '',
        'ef',
        `--${COMMON_BOUNDARY}--`,
      ],
    ],
    boundary: COMMON_BOUNDARY,
    expected: [
      {
        ...COMMON_FILE,
        name: 'upload_file_0',
        data: Buffer.from('ab'),
        filename: `${'a'.repeat(8 * 1024)}.txt`,
        mimeType: 'text/plain',
      },
      {
        ...COMMON_FILE,
        name: 'upload_file_1',
        data: Buffer.from('cd'),
        filename: `${'b'.repeat(8 * 1024)}.txt`,
        mimeType: 'text/plain',
      },
      {
        ...COMMON_FILE,
        name: 'upload_file_2',
        data: Buffer.from('ef'),
        filename: `${'c'.repeat(8 * 1024)}.txt`,
        mimeType: 'text/plain',
      },
    ],
  },
  {
    name: 'Empty part',
    source: [
      ['\r\n--d1bf46b3-aa33-4061-b28d-6c5ced8b08ee\r\n'],
      [
        'Content-Type: application/gzip',
        'Content-Encoding: gzip',
        'Content-Disposition: form-data; name=batch-1; filename=batch-1',
        '',
        '',
      ],
      ['\r\n--d1bf46b3-aa33-4061-b28d-6c5ced8b08ee--'],
    ],
    boundary: 'd1bf46b3-aa33-4061-b28d-6c5ced8b08ee',
    expected: [
      {
        ...COMMON_FILE,
        name: 'batch-1',
        data: Buffer.alloc(0),
        filename: 'batch-1',
        mimeType: 'application/gzip',
      },
    ],
  },
];

describe('Multipart', () => {
  it(
    'reads multipart/form-data content',
    { parameters: tests, timeout: 3000 },
    async ({ boundary, source, expected, options }: any) => {
      const bb = busboy({ 'content-type': `multipart/form-data; boundary=${boundary}` }, options);
      const closed = captureEvents(bb);
      for (const src of source) {
        bb.write(src instanceof Buffer ? src : Buffer.from(src.join('\r\n'), 'utf-8'));
      }
      bb.end();
      const results = await closed;
      expect(results).equals(expected);
    },
  );

  it(
    'works when given one byte at a time',
    { parameters: tests, timeout: 3000 },
    async ({ boundary, source, expected, options }: any) => {
      const bb = busboy({ 'content-type': `multipart/form-data; boundary=${boundary}` }, options);
      const closed = captureEvents(bb);
      for (const src of source) {
        const buf = src instanceof Buffer ? src : Buffer.from(src.join('\r\n'), 'utf-8');
        for (let i = 0; i < buf.byteLength; ++i) {
          bb.write(buf.subarray(i, i + 1));
        }
      }
      bb.end();
      const results = await closed;
      expect(results).equals(expected);
    },
  );

  it(
    'works when fed data via a pipe',
    { parameters: tests, timeout: 3000 },
    async ({ boundary, source, expected, options }: any) => {
      const bb = busboy({ 'content-type': `multipart/form-data; boundary=${boundary}` }, options);
      const closed = captureEvents(bb);
      const parts: Buffer[] = [];
      for (const src of source) {
        parts.push(src instanceof Buffer ? src : Buffer.from(src.join('\r\n'), 'utf-8'));
      }
      Readable.from(parts).pipe(bb);
      const results = await closed;
      expect(results).equals(expected);
    },
  );

  it('rejects an empty boundary', () => {
    expect(() => busboy({ 'content-type': 'multipart/form-data; boundary=""' })).throws(
      'multipart boundary not found',
    );
  });

  it('waits for file streams to be consumed before continuing', { timeout: 3000 }, async () => {
    const BOUNDARY = 'u2KxIV5yF1y+xUspOQCCZopaVgeV6Jxihv35XQJmuTx8X3sh';

    function formDataSection(key: string, value: string) {
      return Buffer.from(
        `\r\n--${BOUNDARY}` +
          `\r\nContent-Disposition: form-data; name="${key}"` +
          `\r\n\r\n${value}`,
      );
    }

    function formDataFile(key: string, filename: string, contentType: string) {
      return Buffer.concat([
        Buffer.from(`\r\n--${BOUNDARY}\r\n`),
        Buffer.from(
          `Content-Disposition: form-data; name="${key}"` + `; filename="${filename}"\r\n`,
        ),
        Buffer.from(`Content-Type: ${contentType}\r\n\r\n`),
        randomFillSync(Buffer.allocUnsafe(100000)),
      ]);
    }

    const reqChunks = [
      Buffer.concat([
        formDataFile('file', 'file.bin', 'application/octet-stream'),
        formDataSection('foo', 'foo value'),
      ]),
      formDataSection('bar', 'bar value'),
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    ];
    const bb = busboy({ 'content-type': `multipart/form-data; boundary=${BOUNDARY}` });

    const results: unknown[] = [];
    bb.on('field', (data) => {
      if (data.type === 'string') {
        results.push(data);
      } else {
        const { value, ...rest } = data;
        results.push({ ...rest, limited: false, truncated: false, err: undefined });
        value.on('error', (error) => results.push({ error: error.message }));
        value.on('close', () => results.push('filestream-close'));
        value.on('end', () => results.push('filestream-end'));
        setTimeout(() => value.resume(), 10);
        // Simulate a pipe where the destination is pausing
        // (perhaps due to waiting for file system write to finish)
        value.on('data', () => results.push('data'));
      }
    });
    bb.on('error', (error) => results.push({ error: error.message }));
    bb.on('warn', (error) => results.push({ warn: error.message }));
    bb.on('close', () => results.push('bb-close'));
    bb.on('finish', () => results.push('bb-finish'));

    await pipeline(Readable.from(reqChunks), bb);

    expect(results).equals([
      { ...COMMON_FILE, name: 'file', filename: 'file.bin' },
      { ...COMMON_FIELD, name: 'foo', value: 'foo value' },
      { ...COMMON_FIELD, name: 'bar', value: 'bar value' },
      'data',
      'filestream-end',
      'filestream-close',
      'bb-finish',
      'bb-close',
    ]);
  });
});

function captureEvents(bb: BusboyInstance): Promise<unknown[]> {
  const results: unknown[] = [];

  bb.on('field', async (data) => {
    if (data.type === 'string') {
      results.push(data);
    } else {
      const { value, ...rest } = data;
      const parts: Buffer[] = [];
      let totalBytes = 0;
      const file = {
        ...rest,
        data: null as Buffer | null,
        limited: false,
        truncated: false,
        err: undefined as unknown,
      };
      results.push(file);
      value.on('data', (d) => {
        parts.push(d);
        totalBytes += d.length;
      });
      value.on('limit', () => {
        file.limited = true;
      });
      value.on('close', () => {
        file.data = Buffer.concat(parts, totalBytes);
        file.truncated = value.truncated;
      });
      value.on('error', (error) => {
        file.err = error.message;
      });
    }
  });

  bb.on('error', (error) => results.push({ error: error.message }));
  bb.on('warn', (error) => results.push({ warn: error.message }));
  bb.on('limit', (type) => results.push(type + 'Limit'));

  return new Promise((resolve) => bb.on('close', () => resolve(results)));
}
