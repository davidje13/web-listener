import { randomFillSync } from 'node:crypto';
import type { BusboyInstance, BusboyOptions } from './types.mts';
import { busboy } from './busboy.mts';
import 'lean-test';

const COMMON_FILE_INFO = {
  nameTruncated: false,
  encoding: '7bit',
  mimeType: 'application/octet-stream',
};

const COMMON_FIELD_INFO = {
  nameTruncated: false,
  valueTruncated: false,
  encoding: '7bit',
  mimeType: 'text/plain',
};

interface TestDef {
  name: string;
  source: (string[] | Buffer)[];
  boundary: string;
  options?: BusboyOptions;
  omit?: string[];
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
      { type: 'field', name: 'file_name_0', val: 'super alpha file', info: COMMON_FIELD_INFO },
      { type: 'field', name: 'file_name_1', val: 'super beta file', info: COMMON_FIELD_INFO },
      {
        type: 'file',
        name: 'upload_file_0',
        data: Buffer.from('A'.repeat(1023)),
        info: { ...COMMON_FILE_INFO, filename: '1k_a.dat' },
        limited: false,
        truncated: false,
        err: undefined,
      },
      {
        type: 'file',
        name: 'upload_file_1',
        data: Buffer.from('B'.repeat(1023)),
        info: { ...COMMON_FILE_INFO, filename: '1k_b.dat' },
        limited: false,
        truncated: false,
        err: undefined,
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
      { type: 'field', name: 'cont', val: 'some random content', info: COMMON_FIELD_INFO },
      { type: 'field', name: 'pass', val: 'some random pass', info: COMMON_FIELD_INFO },
      { type: 'field', name: 'bit', val: '2', info: COMMON_FIELD_INFO },
    ],
  },
  {
    name: 'No fields and no files',
    source: [[]],
    boundary: '----WebKitFormBoundaryTB2MiQ36fnSJlrhY',
    expected: [{ error: 'Unexpected end of form' }],
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
    expected: [{ type: 'field', name: '', val: 'content', info: COMMON_FIELD_INFO }],
  },
  {
    name: 'Missing field name', // TODO: should this be considered invalid?
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
    expected: [{ type: 'field', name: '', val: 'content', info: COMMON_FIELD_INFO }],
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
      {
        type: 'field',
        name: 'file_name_0',
        val: 'super',
        info: { ...COMMON_FIELD_INFO, valueTruncated: true },
      },
      {
        type: 'file',
        name: 'upload_file_0',
        data: Buffer.from('ABCDEFGHIJKLM'),
        info: { ...COMMON_FILE_INFO, filename: '1k_a.dat' },
        limited: true,
        truncated: true,
        err: undefined,
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
      {
        type: 'field',
        name: 'file_name_0',
        val: 'super',
        info: COMMON_FIELD_INFO,
      },
      {
        type: 'file',
        name: 'upload_file_0',
        data: Buffer.from('ABCDEFGHIJKLM'),
        info: { ...COMMON_FILE_INFO, filename: '1k_a.dat' },
        limited: false,
        truncated: false,
        err: undefined,
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
    expected: [
      { type: 'field', name: 'file_name_0', val: 'super alpha file', info: COMMON_FIELD_INFO },
      'filesLimit',
    ],
  },
  {
    name: 'Fields and (ignored) files',
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
    omit: ['file'],
    expected: [
      { type: 'field', name: 'file_name_0', val: 'super alpha file', info: COMMON_FIELD_INFO },
      { type: 'field', name: 'file_name_1', val: 'super beta file', info: COMMON_FIELD_INFO },
    ],
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
        type: 'file',
        name: 'upload_file_0',
        data: Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
        info: { ...COMMON_FILE_INFO, filename: '1k_a.dat' },
        limited: false,
        truncated: false,
        err: undefined,
      },
      {
        type: 'file',
        name: 'upload_file_1',
        data: Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
        info: { ...COMMON_FILE_INFO, filename: '1k_b.dat' },
        limited: false,
        truncated: false,
        err: undefined,
      },
      {
        type: 'file',
        name: 'upload_file_2',
        data: Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
        info: { ...COMMON_FILE_INFO, filename: '1k_c.dat' },
        limited: false,
        truncated: false,
        err: undefined,
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
        type: 'file',
        name: 'upload_file_0',
        data: Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
        info: { ...COMMON_FILE_INFO, filename: '/absolute/1k_a.dat' },
        limited: false,
        truncated: false,
        err: undefined,
      },
      {
        type: 'file',
        name: 'upload_file_1',
        data: Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
        info: { ...COMMON_FILE_INFO, filename: 'C:\\absolute\\1k_b.dat' },
        limited: false,
        truncated: false,
        err: undefined,
      },
      {
        type: 'file',
        name: 'upload_file_2',
        data: Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
        info: { ...COMMON_FILE_INFO, filename: 'relative/1k_c.dat' },
        limited: false,
        truncated: false,
        err: undefined,
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
    expected: [
      { type: 'field', name: 'cont', val: 'some random content', info: COMMON_FIELD_INFO },
    ],
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
        type: 'file',
        name: 'file',
        data: Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ'),
        info: { ...COMMON_FILE_INFO, filename: 'näme.txt' },
        limited: false,
        truncated: false,
        err: undefined,
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
    expected: [
      {
        type: 'file',
        name: 'file',
        data: Buffer.from('.'),
        info: { ...COMMON_FILE_INFO, filename: 'テスト.dat' },
        limited: false,
        truncated: false,
        err: undefined,
      },
    ],
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
    expected: [
      {
        type: 'file',
        name: 'upload_file_0',
        data: Buffer.from('.'),
        info: { ...COMMON_FILE_INFO, filename: '∑µ' },
        limited: false,
        truncated: false,
        err: undefined,
      },
    ],
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
    expected: [{ type: 'field', name: 'f', val: '\u2026', info: COMMON_FIELD_INFO }],
  },
  {
    name: 'Invalid part header',
    source: [[`--${COMMON_BOUNDARY}`, ': oops', '', '', `--${COMMON_BOUNDARY}--`]],
    boundary: COMMON_BOUNDARY,
    expected: [{ error: 'Malformed part header' }],
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
    expected: [{ error: 'Malformed part header' }, { error: 'Unexpected end of form' }],
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
    expected: [{ error: 'Unexpected end of headers' }],
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
    expected: [{ error: 'Unexpected end of headers' }],
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
    expected: [
      {
        type: 'field',
        name: 'cont',
        val: '{}',
        info: { ...COMMON_FIELD_INFO, mimeType: 'application/json' },
      },
    ],
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
        type: 'file',
        name: 'upload_file_0',
        data: Buffer.alloc(0),
        info: { ...COMMON_FILE_INFO, filename: '1k_a.dat', encoding: 'binary' },
        limited: false,
        truncated: false,
        err: 'Unexpected end of form',
      },
      { error: 'Unexpected end of form' },
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
        type: 'file',
        name: 'upload_file_0',
        data: Buffer.from('a'),
        info: { ...COMMON_FILE_INFO, filename: '1k_a.dat' },
        limited: false,
        truncated: false,
        err: 'Unexpected end of form',
      },
      { error: 'Unexpected end of form' },
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
        type: 'file',
        name: 'upload_file_0',
        data: Buffer.from('a'),
        info: { ...COMMON_FILE_INFO, filename: 'notes.txt', mimeType: 'text/plain' },
        limited: false,
        truncated: false,
        err: undefined,
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
        type: 'file',
        name: 'upload_file_0',
        data: Buffer.from('a'),
        info: { ...COMMON_FILE_INFO, filename: 'notes.txt', mimeType: 'text/other' },
        limited: false,
        truncated: false,
        err: undefined,
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
    name: 'Skip field parts if no listener',
    source: [
      [
        `--${COMMON_BOUNDARY}`,
        'Content-Disposition: form-data; name="file_name_0"',
        '',
        'a'.repeat(64 * 1024),
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
    options: { limits: { fieldSize: Number.POSITIVE_INFINITY } },
    omit: ['field'],
    expected: [
      {
        type: 'file',
        name: 'upload_file_0',
        data: Buffer.from('bc'),
        info: { ...COMMON_FILE_INFO, filename: 'notes.txt', mimeType: 'text/plain' },
        limited: false,
        truncated: false,
        err: undefined,
      },
    ],
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
    expected: [{ type: 'field', name: 'file_name_0', val: 'a', info: COMMON_FIELD_INFO }],
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
    expected: [
      { type: 'field', name: 'file_name_0', val: 'a', info: COMMON_FIELD_INFO },
      'partsLimit',
    ],
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
    expected: [{ type: 'field', name: 'file_name_0', val: 'a', info: COMMON_FIELD_INFO }],
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
    expected: [
      { type: 'field', name: 'file_name_0', val: 'a', info: COMMON_FIELD_INFO },
      'fieldsLimit',
    ],
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
        type: 'file',
        name: 'upload_file_0',
        data: Buffer.from('ab'),
        info: { ...COMMON_FILE_INFO, filename: 'notes.txt', mimeType: 'text/plain' },
        limited: false,
        truncated: false,
        err: undefined,
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
        type: 'file',
        name: 'upload_file_0',
        data: Buffer.from('ab'),
        info: { ...COMMON_FILE_INFO, filename: 'notes.txt', mimeType: 'text/plain' },
        limited: false,
        truncated: false,
        err: undefined,
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
      { error: 'Malformed part header' },
      {
        type: 'file',
        name: 'upload_file_1',
        data: Buffer.from('cd'),
        info: { ...COMMON_FILE_INFO, filename: 'notes2.txt', mimeType: 'text/plain' },
        limited: false,
        truncated: false,
        err: undefined,
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
    expected: [
      {
        type: 'field',
        name: 'long',
        val: 'a',
        info: { ...COMMON_FIELD_INFO, nameTruncated: true },
      },
    ],
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
        type: 'file',
        name: 'long',
        data: Buffer.from('a'),
        info: { ...COMMON_FILE_INFO, filename: 'foo.txt', nameTruncated: true },
        limited: false,
        truncated: false,
        err: undefined,
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
        type: 'file',
        name: 'upload_file_0',
        data: Buffer.from('a'.repeat(31) + '\r' + 'b'.repeat(40)),
        info: { ...COMMON_FILE_INFO, filename: 'notes.txt', mimeType: 'text/plain' },
        limited: false,
        truncated: false,
        err: undefined,
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
      { type: 'field', name: 'f1', val: 'a', info: COMMON_FIELD_INFO },
      { type: 'field', name: 'f4', val: 'd', info: COMMON_FIELD_INFO },
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
        type: 'file',
        name: 'upload_file_0',
        data: Buffer.from('ab'),
        info: {
          ...COMMON_FILE_INFO,
          filename: `${'a'.repeat(8 * 1024)}.txt`,
          mimeType: 'text/plain',
        },
        limited: false,
        truncated: false,
        err: undefined,
      },
      {
        type: 'file',
        name: 'upload_file_1',
        data: Buffer.from('cd'),
        info: {
          ...COMMON_FILE_INFO,
          filename: `${'b'.repeat(8 * 1024)}.txt`,
          mimeType: 'text/plain',
        },
        limited: false,
        truncated: false,
        err: undefined,
      },
      {
        type: 'file',
        name: 'upload_file_2',
        data: Buffer.from('ef'),
        info: {
          ...COMMON_FILE_INFO,
          filename: `${'c'.repeat(8 * 1024)}.txt`,
          mimeType: 'text/plain',
        },
        limited: false,
        truncated: false,
        err: undefined,
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
        type: 'file',
        name: 'batch-1',
        data: Buffer.alloc(0),
        info: { ...COMMON_FILE_INFO, filename: 'batch-1', mimeType: 'application/gzip' },
        limited: false,
        truncated: false,
        err: undefined,
      },
    ],
  },
];

describe('Multipart', () => {
  it(
    'reads multipart/form-data content',
    { parameters: tests },
    async ({ boundary, omit, source, expected, options }: any) => {
      const bb = busboy({ 'content-type': `multipart/form-data; boundary=${boundary}` }, options);
      const closed = captureEvents(bb, omit);
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
    { parameters: tests },
    async ({ boundary, omit, source, expected, options }: any) => {
      const bb = busboy({ 'content-type': `multipart/form-data; boundary=${boundary}` }, options);
      const closed = captureEvents(bb, omit);
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

  it('rejects an empty boundary', () => {
    expect(() => busboy({ 'content-type': 'multipart/form-data; boundary=""' })).throws(
      'Multipart: Boundary not found',
    );
  });

  it('waits for file streams to be consumed before continuing', async () => {
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
    bb.on('field', (name, val, info) => results.push({ type: 'field', name, val, info }));
    bb.on('file', (name, stream, info) => {
      results.push({ type: 'file', name, info });
      // Simulate a pipe where the destination is pausing
      // (perhaps due to waiting for file system write to finish)
      setTimeout(() => stream.resume(), 10);
    });

    await new Promise<void>((resolve) => {
      bb.on('close', resolve);
      for (const chunk of reqChunks) {
        bb.write(chunk);
      }
      bb.end();
    });

    expect(results).equals([
      { type: 'file', name: 'file', info: { ...COMMON_FILE_INFO, filename: 'file.bin' } },
      { type: 'field', name: 'foo', val: 'foo value', info: COMMON_FIELD_INFO },
      { type: 'field', name: 'bar', val: 'bar value', info: COMMON_FIELD_INFO },
    ]);
  });
});

function captureEvents(bb: BusboyInstance, omit: string[] = []): Promise<unknown[]> {
  const results: unknown[] = [];

  if (!omit.includes('field')) {
    bb.on('field', (name, val, info) => results.push({ type: 'field', name, val, info }));
  }
  if (!omit.includes('file')) {
    bb.on('file', (name, stream, info) => {
      const data: Buffer[] = [];
      let nb = 0;
      const file = {
        type: 'file',
        name,
        data: null as Buffer | null,
        info,
        limited: false,
        truncated: false,
        err: undefined as unknown,
      };
      results.push(file);
      stream.on('data', (d) => {
        data.push(d);
        nb += d.length;
      });
      stream.on('limit', () => {
        file.limited = true;
      });
      stream.on('close', () => {
        file.data = Buffer.concat(data, nb);
        file.truncated = stream.truncated;
      });
      stream.on('error', (err) => {
        file.err = err.message;
      });
    });
  }

  bb.on('error', (err) => results.push({ error: err.message }));
  bb.on('partsLimit', () => results.push('partsLimit'));
  bb.on('filesLimit', () => results.push('filesLimit'));
  bb.on('fieldsLimit', () => results.push('fieldsLimit'));

  return new Promise((resolve) => bb.on('close', () => resolve(results)));
}
