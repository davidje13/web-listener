import type { Readable, Writable } from 'node:stream';

export interface BusboyOptions {
  /**
   * `true` to block `multipart/form-data` (including file uploads). If set, only `application/x-www-form-urlencoded` is supported.
   * @default false
   */
  blockMultipart?: boolean;

  limits?: Limits;

  /**
   * `true` to preserve path information in filenames. `false` to only include the basename (omitting everything before the last `/` or `\`)
   * @default false
   */
  preservePath?: boolean;

  /**
   * High water mark to set on the underlying stream.
   * @default 65536
   */
  highWaterMark?: number;

  /**
   * High water mark to set on file streams.
   * @default 65536
   */
  fileHwm?: number;

  /**
   * Default character set to use for reading name and filename from the content-disposition header in multipart content.
   * According to the standard this should be `latin1`, but most browsers use `utf-8`.
   * @default 'utf-8'
   */
  defParamCharset?: string;

  /**
   * Default character set to use for reading field content (and field names in urlencoded content).
   * @default 'utf-8'
   */
  defCharset?: string;
}

export type FieldData = {
  name: string;
  _nameTruncated: boolean;
  mimeType: string;
  encoding: string;
} & (
  | { type: 'string'; value: string; _valueTruncated: boolean }
  | {
      type: 'file';
      value: Readable & { readonly truncated: boolean };
      _valueTruncated?: never;
      filename: string;
    }
);

export type BusboyInstance = Omit<Writable, keyof NodeJS.EventEmitter> &
  NodeJS.EventEmitter<{
    close: [];
    drain: [];
    error: [error: Error];
    finish: [];
    pipe: [src: Readable];
    unpipe: [src: Readable];

    limit: [type: string];
    field: [data: FieldData];
  }>;

export interface Limits {
  /**
   * Max field name size (in bytes).
   * @default 100
   */
  fieldNameSize?: number | undefined;

  /**
   * Max field value size (in bytes).
   * @default 1048576 (1MB)
   */
  fieldSize?: number | undefined;

  /**
   * Max number of non-file fields.
   * @default Infinity
   */
  fields?: number | undefined;

  /**
   * For multipart forms, the max file size (in bytes).
   * @default Infinity
   */
  fileSize?: number | undefined;

  /**
   * For multipart forms, the max number of file fields.
   * @default Infinity
   */
  files?: number | undefined;

  /**
   * For multipart forms, the max number of parts (fields + files).
   * @default Infinity
   */
  parts?: number | undefined;
}

declare global {
  interface Buffer {
    // undocumented methods, used for speed
    // https://github.com/nodejs/node/blob/5e1ab9fffb8399fcc51ab1b592d0fffef4e418aa/typings/internalBinding/buffer.d.ts#L28
    // https://github.com/nodejs/node/issues/46467
    latin1Slice(begin?: number, end?: number): string;
  }
}
