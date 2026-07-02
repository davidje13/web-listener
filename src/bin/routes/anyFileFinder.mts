import { stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import {
  dynamicFileFinder,
  negotiateEncoding,
  Negotiator,
  readZip,
  staticFileFinder,
  zipFileFinder,
  type FileFinder,
  type FileServerOptions,
} from '../../index.mts';
import { TransientError } from '../TransientError.mts';

export async function anyFileFinder(path: string, options: FileServerOptions): Promise<FileFinder> {
  const direct = await stat(path).catch(() => null);
  if (direct?.isDirectory()) {
    if (options.mode === 'static-paths') {
      return staticFileFinder(path, options);
    } else {
      return dynamicFileFinder(path, options);
    }
  }

  const parts = path.split(sep);
  if (parts[parts.length - 1] === '') {
    parts.pop();
  }
  if (!parts[0]) {
    parts.shift();
    if (parts.length > 0) {
      parts[0] = sep + parts[0];
    }
  }
  for (let i = parts.length; i > 0; --i) {
    const filePath = join(...parts.slice(0, i));
    const stats = await stat(filePath).catch(() => null);
    if (!stats) {
      continue;
    }
    if (!stats.isFile()) {
      break;
    }
    const zipRoot = await readZip(filePath);
    const zipDir = zipRoot.find(parts.slice(i));
    if (!zipDir?.isDirectory) {
      throw new Error(`${parts.slice(i).join('/')} in ${filePath} is not a directory`);
    }
    const adjustedOptions = options;
    if (!adjustedOptions.negotiator) {
      adjustedOptions.negotiator = new Negotiator([negotiateEncoding(['deflate'])]);
    }
    return zipFileFinder(zipDir, adjustedOptions);
  }
  throw new TransientError(`content to serve not found at ${path}`);
}
