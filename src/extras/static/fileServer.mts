import type { FileFinderOptions } from '../filesystem/FileFinder.mts';
import { staticFileFinder } from '../filesystem/staticFileFinder.mts';
import { dynamicFileFinder } from '../filesystem/dynamicFileFinder.mts';
import { assetServer, type AssetServerOptions } from './assetServer.mts';

export interface FileServerOptions extends AssetServerOptions, FileFinderOptions {
  /**
   * The mode of serving files to use.
   *
   * 'dynamic' checks the filesystem for each request.
   * This is a good choice for local development, and for production in cases where files in a
   * directory are able to change at runtime (e.g. uploaded content).
   *
   * 'static-paths' scans the directory at startup then uses an in-memory reference to check
   * requested paths.
   * This can improve performance and increase security, as long as the list of avalable files
   * will not change at runtime. The contents of the files are still loaded for each request.
   * This is usually a good choice for production deployments.
   *
   * @default 'dynamic'
   */
  mode?: 'dynamic' | 'static-paths' | undefined;
}

/**
 * Set up a server for static files in a directory. The options are secure by default.
 * Requests for files which are not permitted or do not exist will return NEXT_ROUTE and can be
 * handled by subsequent routes.
 *
 * @param baseDir the path to the directory to serve (relative paths are to the current working directory)
 * @param options custom configuration to apply
 * @returns a promise of a server handler function (note this should be `await`ed before being used as a handler!)
 */
export const fileServer = async (baseDir: string, options: FileServerOptions = {}) =>
  assetServer(
    options.mode === 'static-paths'
      ? await staticFileFinder(baseDir, options)
      : await dynamicFileFinder(baseDir, options),
    options,
  );
