import type { Readable } from 'node:stream';

export interface BusboyOptions {
  /**
   * `true` to block `multipart/form-data` (including file uploads). If set, only `application/x-www-form-urlencoded` is supported.
   * @default false
   */
  blockMultipart?: boolean;

  /**
   * `true` to preserve path information in filenames. `false` to only include the basename (omitting everything before the last `/` or `\`)
   * @default false
   */
  preservePath?: boolean;

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

  /**
   * The maximum content length as sent (including e.g. multipart boundaries and headers)
   * @default Infinity
   */
  maxNetworkBytes?: number;

  /**
   * The maximum content length, combining all field names, values, and files
   * @default maxNetworkBytes
   */
  maxContentBytes?: number;

  /**
   * The maximum field name size (in bytes).
   * @default 100
   */
  maxFieldNameSize?: number | undefined;

  /**
   * The maximum field value size (in bytes).
   * @default 1048576 (1MB)
   */
  maxFieldSize?: number | undefined;

  /**
   * The maximum number of non-file fields.
   * @default Infinity
   */
  maxFields?: number | undefined;

  /**
   * For multipart forms, the maximum file size (in bytes).
   * @default Infinity
   */
  maxFileSize?: number | undefined;

  /**
   * For multipart forms, the maximum combined file size (in bytes) for all files in the request.
   * @default Infinity
   */
  maxTotalFileSize?: number | undefined;

  /**
   * For multipart forms, the maximum number of files.
   * @default Infinity
   */
  maxFiles?: number | undefined;

  /**
   * For multipart forms, the maximum number of parts (fields + files).
   * @default Infinity
   */
  maxParts?: number | undefined;
}

interface CommonFormField {
  name: string;
  mimeType: string;
  encoding: string;
}

interface FileFormField extends CommonFormField {
  type: 'file';
  value: Readable;
  filename: string;
  sizeLimit: number;
}

interface StringFormField extends CommonFormField {
  type: 'string';
  value: string;
}

export type FormField = StringFormField | FileFormField;

export type StreamConsumer = (
  source: Readable,
  callback: (field: FormField) => void,
) => Promise<void>;

declare global {
  interface Buffer {
    // undocumented methods, used for speed
    // https://github.com/nodejs/node/blob/5e1ab9fffb8399fcc51ab1b592d0fffef4e418aa/typings/internalBinding/buffer.d.ts#L28
    // https://github.com/nodejs/node/issues/46467
    latin1Slice(begin?: number, end?: number): string;
  }
}
