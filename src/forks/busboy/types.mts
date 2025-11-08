import type { Readable, Writable } from 'node:stream';

export interface BusboyOptions {
  /**
   * True to block `multipart/form-data` (including file uploads). If set, only `application/x-www-form-urlencoded` is supported.
   * @default false
   */
  blockMultipart?: boolean;
  limits?: Limits;
  preservePath?: boolean;
  highWaterMark?: number;
  fileHwm?: number;
  defParamCharset?: string;
  defCharset?: string;
}

type FileStream = Readable & { readonly truncated: boolean };

interface FileInfo {
  nameTruncated: boolean;
  filename: string | undefined;
  encoding: string;
  mimeType: string;
}

interface FieldInfo {
  nameTruncated: boolean;
  valueTruncated: boolean;
  encoding: string;
  mimeType: string;
}

export type JoinType<Super extends abstract new (...args: any) => any, T> = {
  new (...args: ConstructorParameters<Super>): InstanceType<Super> & T;
};

export type BusboyInstance = Omit<Writable, keyof NodeJS.EventEmitter> &
  NodeJS.EventEmitter<{
    close: [];
    drain: [];
    error: [Error];
    finish: [];
    pipe: [Readable];
    unpipe: [Readable];

    filesLimit: [];
    fieldsLimit: [];
    partsLimit: [];
    limit: [];
    file: [string, FileStream, FileInfo];
    field: [string, string, FieldInfo];
  }>;

export interface Limits {
  /**
   * Max field name size (in bytes).
   *
   * @default 100
   */
  fieldNameSize?: number | undefined;

  /**
   * Max field value size (in bytes).
   *
   * @default 1048576 (1MB)
   */
  fieldSize?: number | undefined;

  /**
   * Max number of non-file fields.
   *
   * @default Infinity
   */
  fields?: number | undefined;

  /**
   * For multipart forms, the max file size (in bytes).
   *
   * @default Infinity
   */
  fileSize?: number | undefined;

  /**
   * For multipart forms, the max number of file fields.
   *
   * @default Infinity
   */
  files?: number | undefined;

  /**
   * For multipart forms, the max number of parts (fields + files).
   *
   * @default Infinity
   */
  parts?: number | undefined;

  /**
   * For multipart forms, the max number of header key-value pairs to parse.
   *
   * @default 2000 (same as node's http module)
   */
  headerPairs?: number | undefined;
}
