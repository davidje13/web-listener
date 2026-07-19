import type { IncomingMessage } from 'node:http';
import { openAsBlob } from 'node:fs';
import { busboy } from '../../forks/busboy/busboy.mts';
import type { BusboyOptions, FormField } from '../../forks/busboy/types.mts';
import { addTeardown } from '../../core/close.mts';
import { STOP } from '../../core/RoutingInstruction.mts';
import type { MaybePromise } from '../../util/MaybePromise.mts';
import { BlockingQueue } from '../../util/BlockingQueue.mts';
import { guardTimeout } from '../../util/guardTimeout.mts';
import { makeTempFileStorage } from '../filesystem/tempFileStorage.mts';
import { acceptBody, willSendBody } from './continue.mts';

// https://datatracker.ietf.org/doc/html/rfc7578

export function getFormFields(
  req: IncomingMessage,
  { closeAfterErrorDelay = 500, ...options }: GetFormFieldsOptions = {},
): AsyncIterable<FormField, unknown, undefined> {
  guardTimeout(closeAfterErrorDelay, 'closeAfterErrorDelay', true);

  const timeoutConnection = () => {
    // if the client continues sending a lot of data after an error, kill the socket to stop them
    if (closeAfterErrorDelay >= 0 && req.readable) {
      const forceStop = setTimeout(() => req.socket.destroy(), closeAfterErrorDelay);
      req.once('end', () => clearTimeout(forceStop));
    }
  };

  try {
    const bus = busboy(req.headers, options);
    acceptBody(req);

    const output = new BlockingQueue<FormField>(); //{ hwm: 2, lwm: 1 });
    // backpressure
    //output.on('hwm', () => req.pause());
    //output.on('lwm', () => req.resume());

    bus(req, (field) => output.push(field)).then(
      () => output.close('complete'),
      (err) => {
        output.fail(req.readableAborted ? STOP : err);
        req.resume();
        timeoutConnection();
      },
    );
    return output;
  } catch (error: unknown) {
    if (willSendBody(req)) {
      // Allow the client to send their data even though we will ignore it.
      // If they can send it quickly, we can still reuse this connection for future requests.
      req.resume();
      timeoutConnection();
    }
    throw error;
  }
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
        maxBytes: field.sizeLimit,
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
  closeAfterErrorDelay?: number | undefined;
}

export interface GetFormDataOptions extends GetFormFieldsOptions {
  /** true to apply .trim() to all field values */
  trimAllValues?: boolean | undefined;

  /** function to apply to all uploaded files (e.g. to check available disk space) */
  preCheckFile?: PreCheckFile | undefined;
}

export type PreCheckFile = (info: PreCheckFileInfo) => MaybePromise<PostCheckFile | void>;

export interface PreCheckFileInfo {
  fieldName: string;
  filename: string;
  encoding: string;
  mimeType: string;
  maxBytes: number;
}

export type PostCheckFile = (actual: PostCheckFileInfo) => MaybePromise<void>;

export interface PostCheckFileInfo {
  actualBytes: number;
}

export type { FormField };

export interface AugmentedFormData extends FormData {
  /**
   * Return the full path to the temporary file created for an uploaded file.
   * This can be used for some optimisations. For example, it is usually faster
   * to move this temporary file to a desired location than to write a new file
   * by streaming the content.
   *
   * @param file the file to find. This should be the value returned by `getFile(name)` or `getAllFiles(name)`.
   * @returns the absolute path to the requested file.
   */
  getTempFilePath(file: Blob): string;
  /**
   * Return the first field with the requested field name, as a boolean.
   * The values 'true' and 'on' are recognised as `true`. Everything else is `false`.
   */
  getBoolean(name: string): boolean | null;
  /**
   * Return the first field with the requested field name, as a string.
   * If the field is not present, or is a file, this returns `null`.
   */
  getString(name: string): string | null;
  /** Return all fields with the requested field name, as strings. Ignores files. */
  getAllStrings(name: string): string[];
  /**
   * Return the first file with the requested field name.
   * If the field is not present, or is not a file, this returns `null`.
   */
  getFile(name: string): File | null;
  /** Return all files with the requested field name. */
  getAllFiles(name: string): File[];
}
