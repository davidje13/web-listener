import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';
import { openAsBlob } from 'node:fs';
import busboy from 'busboy';
import { HTTPError, type HTTPErrorOptions } from '../../core/HTTPError.mts';
import { addTeardown } from '../../core/close.mts';
import type { MaybePromise } from '../../util/MaybePromise.mts';
import { STOP } from '../../core/RoutingInstruction.mts';
import { BlockingQueue } from '../../util/BlockingQueue.mts';
import { makeTempFileStorage } from '../filesystem/tempFileStorage.mts';
import { acceptBody } from './continue.mts';

// https://datatracker.ietf.org/doc/html/rfc7578

export function getFormFields(
  req: IncomingMessage,
  { allowMultipart = false, closeAfterErrorDelay = 500, limits = {} }: GetFormFieldsConfig = {},
): AsyncIterable<FormField, unknown, undefined> {
  const type = req.headers['content-type'] ?? '';
  const supported =
    /^application\/x-www-form-urlencoded\s*(;|$)/i.test(type) ||
    (allowMultipart && /^multipart\/form-data\s*(;|$)/i.test(type));
  if (!supported) {
    throw new HTTPError(415);
  }

  acceptBody(req);

  const output = new BlockingQueue<FormField>();
  limits = { ...limits };
  if (!allowMultipart) {
    limits.files = 0;
  }

  const fail = (status: number, options: HTTPErrorOptions) => {
    output.fail(new HTTPError(status, options));
    // busboy continues to read the input (and produce events) after an error, so disconnect it
    bus.removeAllListeners();
    req.unpipe(bus);
    req.resume();

    // if the client continues sending a lot of data after an error, kill the socket to stop them
    if (closeAfterErrorDelay >= 0) {
      const forceStop = setTimeout(() => req.socket.destroy(), closeAfterErrorDelay);
      req.once('end', () => clearTimeout(forceStop));
    }
  };

  const fieldNameLimit = limits.fieldNameSize ?? 100;

  const bus = busboy({ headers: req.headers, limits, preservePath: false });
  bus.on('field', (name, val, { nameTruncated, valueTruncated, encoding, mimeType }) => {
    if (!name) {
      return fail(400, { body: 'missing field name' });
    }
    if (nameTruncated || name.length > fieldNameLimit) {
      return fail(400, {
        body: `field name ${JSON.stringify(name.slice(0, fieldNameLimit))}... too long`,
      });
    }
    if (valueTruncated) {
      return fail(400, { body: `value for ${JSON.stringify(name)} too long` });
    }
    output.push({ name, encoding, mimeType, type: 'string', value: val });
  });

  bus.on('file', (name, stream, { filename, encoding, mimeType }) => {
    if (name === null) {
      return fail(400, { body: 'missing field name' });
    }
    if (name.length > fieldNameLimit) {
      return fail(400, {
        body: `field name ${JSON.stringify(name.slice(0, fieldNameLimit))}... too long`,
      });
    }
    if (!filename) {
      // if a file field is submitted without any files, it will send an empty entry: ignore it
      stream.resume();
      return;
    }
    stream.once('limit', () =>
      fail(400, {
        body: `uploaded file for ${JSON.stringify(name)}: ${JSON.stringify(filename)} too large`,
      }),
    );
    output.push({ name, encoding, mimeType, type: 'file', value: stream, filename });
  });

  req.once('error', (error) => {
    if (req.readableAborted) {
      output.fail(STOP);
    } else {
      fail(500, { body: 'request error', headers: { connection: 'close' }, cause: error });
    }
  });
  bus.once('error', (error) => fail(400, { body: 'error parsing form data', cause: error }));
  bus.once('partsLimit', () => fail(400, { body: 'too many parts' }));
  bus.once('filesLimit', () => fail(400, { body: 'too many files' }));
  bus.once('fieldsLimit', () => fail(400, { body: 'too many fields' }));

  const stop = () => output.close('complete');
  bus.once('close', stop);
  addTeardown(req, stop);
  req.pipe(bus);

  return output;
}

export async function getFormData(
  req: IncomingMessage,
  config: GetFormDataConfig = {},
): Promise<AugmentedFormData> {
  const data = new FormData();
  const pathLookup = new Map<Blob, string>();

  for await (const field of getFormFields(req, config)) {
    if (field.type === 'file') {
      const stream = field.value;
      let postCheck = await config.preCheckFile?.({
        fieldName: field.name,
        filename: field.filename,
        encoding: field.encoding,
        mimeType: field.mimeType,
        maxBytes: config.limits?.fileSize,
      });
      const runPostCheck = (actualBytes: number) => {
        if (typeof postCheck === 'function') {
          const pct = postCheck;
          postCheck = undefined;
          return pct({ actualBytes });
        }
      };
      addTeardown(req, () => runPostCheck(0));
      const tempDir = await makeTempFileStorage(req);
      const tempUpload = await tempDir.save(stream, { mode: 0o600 });
      await runPostCheck(tempUpload.size);
      const file = new File([await openAsBlob(tempUpload.path)], field.filename, {
        type: field.mimeType,
      });
      pathLookup.set(file, tempUpload.path);
      data.append(field.name, file);
    } else {
      let val = field.value;
      if (config.trimAllValues) {
        val = val.trim();
      }
      data.append(field.name, val);
    }
  }
  return Object.assign(data, {
    getTempFilePath(file: Blob) {
      const path = pathLookup.get(file);
      if (!path) {
        throw new Error('unknown file');
      }
      return path;
    },

    getBoolean(name: string) {
      const value = data.get(name);
      return value === null ? null : value === 'true' || value === 'on';
    },
  });
}

export interface GetFormFieldsConfig {
  allowMultipart?: boolean;
  closeAfterErrorDelay?: number;
  limits?: Limits;
}

export interface GetFormDataConfig extends GetFormFieldsConfig {
  /** true to apply .trim() to all field values */
  trimAllValues?: boolean;

  /** function to apply to all uploaded files (e.g. to check available disk space) */
  preCheckFile?: PreCheckFile;
}

export type PreCheckFile = (info: PreCheckFileInfo) => MaybePromise<PostCheckFile | void>;

export interface PreCheckFileInfo {
  fieldName: string;
  filename: string;
  encoding: string;
  mimeType: string;
  maxBytes: number | undefined;
}

export type PostCheckFile = (actual: PostCheckFileInfo) => MaybePromise<void>;

export interface PostCheckFileInfo {
  actualBytes: number;
}

export type FormField = { name: string; mimeType: string; encoding: string } & (
  | { type: 'string'; value: string }
  | { type: 'file'; value: Readable; filename: string }
);

export interface AugmentedFormData extends FormData {
  getTempFilePath(file: Blob): string;

  getBoolean(name: string): boolean | null;
}

// Limits interface comes from busboy (duplicated here to avoid runtime dependency on @types/busboy)
interface Limits {
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
