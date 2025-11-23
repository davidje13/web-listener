import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';
import { openAsBlob } from 'node:fs';
import { busboy } from '../../forks/busboy/busboy.mts';
import type { BusboyOptions } from '../../forks/busboy/types.mts';
import { HTTPError, type HTTPErrorOptions } from '../../core/HTTPError.mts';
import { addTeardown } from '../../core/close.mts';
import type { MaybePromise } from '../../util/MaybePromise.mts';
import { STOP } from '../../core/RoutingInstruction.mts';
import { BlockingQueue } from '../../util/BlockingQueue.mts';
import { guardTimeout } from '../../util/guardTimeout.mts';
import { makeTempFileStorage } from '../filesystem/tempFileStorage.mts';
import { acceptBody } from './continue.mts';

// https://datatracker.ietf.org/doc/html/rfc7578

export function getFormFields(
  req: IncomingMessage,
  { closeAfterErrorDelay = 500, ...options }: GetFormFieldsOptions = {},
): AsyncIterable<FormField, unknown, undefined> {
  guardTimeout(closeAfterErrorDelay, 'closeAfterErrorDelay', true);
  const bus = busboy(req.headers, options);

  acceptBody(req);

  const output = new BlockingQueue<FormField>();

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

  bus.on('field', (name, val, { nameTruncated, valueTruncated, encoding, mimeType }) => {
    if (!name) {
      return fail(400, { body: 'missing field name' });
    }
    if (nameTruncated) {
      return fail(400, {
        body: `field name ${JSON.stringify(name)}... too long`,
      });
    }
    if (valueTruncated) {
      return fail(400, { body: `value for ${JSON.stringify(name)} too long` });
    }
    output.push({ name, encoding, mimeType, type: 'string', value: val });
  });

  bus.on('file', (name, stream, { nameTruncated, filename, encoding, mimeType }) => {
    if (!name) {
      return fail(400, { body: 'missing field name' });
    }
    if (nameTruncated) {
      return fail(400, {
        body: `field name ${JSON.stringify(name)}... too long`,
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
  options: GetFormDataOptions = {},
): Promise<AugmentedFormData> {
  const data = new FormData();
  const pathLookup = new Map<Blob, string>();

  for await (const field of getFormFields(req, options)) {
    if (field.type === 'file') {
      const stream = field.value;
      let postCheck = await options.preCheckFile?.({
        fieldName: field.name,
        filename: field.filename,
        encoding: field.encoding,
        mimeType: field.mimeType,
        maxBytes: options.limits?.fileSize,
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
      if (options.trimAllValues) {
        val = val.trim();
      }
      data.append(field.name, val);
    }
  }
  return Object.assign(data, {
    getTempFilePath(file: Blob) {
      const path = pathLookup.get(file);
      if (!path) {
        throw new RangeError('unknown file');
      }
      return path;
    },

    getBoolean(name: string) {
      const value = data.get(name);
      return value === null ? null : value === 'true' || value === 'on';
    },

    getString(name: string) {
      const value = data.get(name);
      return typeof value === 'string' ? value : null;
    },

    getAllStrings(name: string) {
      return data.getAll(name).filter((v) => typeof v === 'string');
    },

    getFile(name: string) {
      const value = data.get(name);
      return typeof value === 'string' ? null : value;
    },

    getAllFiles(name: string) {
      return data.getAll(name).filter((v) => typeof v !== 'string');
    },
  });
}

export interface GetFormFieldsOptions extends BusboyOptions {
  /**
   * Delay (in milliseconds) before forcibly closing the request if an error occurs (e.g. a limit is exceeded).
   * This can be used to prevent clients uploading large files when the request has already been rejected.
   * @default 500
   */
  closeAfterErrorDelay?: number;
}

export interface GetFormDataOptions extends GetFormFieldsOptions {
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
  getString(name: string): string | null;
  getAllStrings(name: string): string[];
  getFile(name: string): File | null;
  getAllFiles(name: string): File[];
}
