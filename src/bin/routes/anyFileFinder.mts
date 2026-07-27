import { stat } from 'node:fs/promises';
import {
  dynamicFileFinder,
  SHARED_ASSET_OPENER,
  negotiateEncoding,
  Negotiator,
  staticFileFinder,
  zipFileFinder,
  type FileFinder,
  type FileServerOptions,
} from '../../index.mts';
import { TransientError } from '../TransientError.mts';
import { UserError } from '../UserError.mts';

export async function anyFileFinder(path: string, options: FileServerOptions): Promise<FileFinder> {
  const direct = await stat(path).catch(() => null);
  if (direct?.isDirectory()) {
    if (options.mode === 'static-paths') {
      return staticFileFinder(path, options);
    } else {
      return dynamicFileFinder(path, options);
    }
  }

  const zipDir = await SHARED_ASSET_OPENER.findZipNode(path);
  if (!zipDir) {
    throw new TransientError(`content to serve not found at ${path}`);
  }
  if (!zipDir?.isDirectory) {
    throw new UserError(`${path} is not a directory`);
  }
  const adjustedOptions = options;
  if (!adjustedOptions.negotiator) {
    adjustedOptions.negotiator = new Negotiator([negotiateEncoding(['gzip'])]);
  }
  return zipFileFinder(zipDir, adjustedOptions);
}
