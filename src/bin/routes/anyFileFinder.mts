import { stat } from 'node:fs/promises';
import {
  dynamicFileFinder,
  negotiateEncoding,
  Negotiator,
  staticFileFinder,
  zipFileFinder,
  type FileFinder,
  type FileServerOptions,
} from '../../index.mts';
import { TransientError } from '../TransientError.mts';
import { readZipPath } from '../zipCache.mts';

export async function anyFileFinder(path: string, options: FileServerOptions): Promise<FileFinder> {
  const direct = await stat(path).catch(() => null);
  if (direct?.isDirectory()) {
    if (options.mode === 'static-paths') {
      return staticFileFinder(path, options);
    } else {
      return dynamicFileFinder(path, options);
    }
  }

  const zip = await readZipPath(path, false);
  if (!zip) {
    throw new TransientError(`content to serve not found at ${path}`);
  }

  const zipDir = zip.root.find(zip.remaining);
  if (!zipDir?.isDirectory) {
    throw new Error(`/${zip.remaining.join('/')} in ${zip.path} is not a directory`);
  }
  const adjustedOptions = options;
  if (!adjustedOptions.negotiator) {
    adjustedOptions.negotiator = new Negotiator([negotiateEncoding(['gzip'])]);
  }
  return zipFileFinder(zipDir, adjustedOptions);
}
