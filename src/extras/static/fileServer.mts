import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, resolve } from 'node:path';
import { CONTINUE } from '../../core/RoutingInstruction.mts';
import type { RequestHandler } from '../../core/handler.mts';
import { HTTPError } from '../../core/HTTPError.mts';
import type { MaybePromise } from '../../util/MaybePromise.mts';
import { getRemainingPathComponents } from '../request/pathComponents.mts';
import { sendFile } from '../response/sendFile.mts';
import { generateWeakETag } from '../cache/etag.mts';
import { emitError } from '../error/emitError.mts';
import { getMime } from '../registries/mime.mts';
import {
  FileFinder,
  type FileFinderOptions,
  type ResolvedFileInfo,
} from '../filesystem/FileFinder.mts';

export interface FileServerOptions extends FileFinderOptions {
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

  /**
   * Serve a file if the requested path is not found.
   * By default, the handler will return `CONTINUE`, but by providing this option you can
   * automatically return a particular file as fallback content (e.g. for Single-Page-Apps).
   *
   * Compression, cache control, and range requests will continue to work as usual.
   */
  fallback?: FallbackOptions | undefined;

  /**
   * Enable verbose error messages when a file is not found.
   * When this is false, only failures to find the fallback file will include verbose details.
   *
   * @default false
   */
  verbose?: boolean;

  /**
   * A function to call when a file is being served. Can modify headers in the response.
   * The default implementation is:
   *
   *  ```
   *  res.setHeader('etag', generateWeakETag(res.getHeader('content-encoding'), file.stats));
   *  res.setHeader('last-modified', file.stats.mtime.toUTCString());
   *  ```
   *
   * If you override this function, you must decide which cache headers you wish to set.
   *
   * This function is called after the `Content-Type` and `Content-Encoding` headers have been set,
   * so you can inspect those if you need to know the mime type or encoding of the response, or
   * change them if you want to set different values.
   *
   * @param req
   * @param res
   * @param file information about the file, including `fs.Stats` and an active `FileHandle`
   * @param isFallback `true` if the file is being served as a fallback (e.g. error page or Single-Page-App)
   */
  callback?:
    | ((
        req: IncomingMessage,
        res: ServerResponse,
        file: ResolvedFileInfo,
        isFallback: boolean,
      ) => MaybePromise<void>)
    | undefined;
}

export interface FallbackOptions {
  /**
   * The status code to return with the fallback content.
   *
   * @default 200 (OK)
   */
  statusCode?: number | undefined;

  /**
   * The path of the fallback content to use.
   */
  filePath: string;
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
export const fileServer = async (
  baseDir: string,
  {
    mode = 'dynamic',
    fallback,
    verbose,
    callback = setDefaultCacheHeaders,
    ...options
  }: FileServerOptions = {},
): Promise<RequestHandler> => {
  const fileFinder = await FileFinder.build(resolve(process.cwd(), baseDir), options);

  let fallbackPath: string[] | null = null;
  const fallbackStatusCode = fallback?.statusCode ?? 200;
  if (fallback) {
    let path = fallback.filePath;
    if (path.startsWith('/')) {
      path = path.substring(1);
    }
    fallbackPath = fileFinder.toNormalisedPath(path.split('/'));
  }

  const pathOptions = mode === 'dynamic' ? {} : { rejectPotentiallyUnsafe: false };
  const fileLookup = mode === 'dynamic' ? fileFinder : await fileFinder.precompute();

  return {
    handleRequest: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return CONTINUE;
      }
      let isFallback = false;
      const path = getRemainingPathComponents(req, pathOptions);
      const warnings: string[] = [];
      let file = await fileLookup.find(path, req.headers, verbose ? warnings : undefined);
      if (!file) {
        if (!fallbackPath) {
          if (verbose) {
            emitError(req, new Error(warnings.join(', ')), 'serving static content');
          }
          return CONTINUE;
        }
        isFallback = true;
        file = await fileLookup.find(fallbackPath, req.headers, warnings);
        if (!file) {
          throw new HTTPError(500, {
            message: `failed to find fallback file: ${warnings.join(', ')}`,
          });
        }
      }
      try {
        if (isFallback) {
          res.statusCode = fallbackStatusCode;
        }

        const contentType = file.headers['content-type'] ?? getMime(extname(file.canonicalPath));
        res.setHeader('content-type', contentType);

        const contentLanguage = file.headers['content-language'];
        if (contentLanguage) {
          res.setHeader('content-language', contentLanguage);
        }

        const contentEncoding = file.headers['content-encoding'];
        if (contentEncoding && contentEncoding !== 'identity') {
          res.setHeader('content-encoding', contentEncoding);
        }

        const vary = file.headers.vary;
        if (vary) {
          const existing = res.getHeader('vary') ?? '';
          res.setHeader('vary', (existing ? existing + ', ' : '') + vary);
        }

        await callback(req, res, file, isFallback);
        await sendFile(req, res, file.handle, file.stats);
      } finally {
        file.handle.close().catch(() => {});
      }
      return;
    },
  };
};

export function setDefaultCacheHeaders(
  req: IncomingMessage,
  res: ServerResponse,
  file: ResolvedFileInfo,
) {
  void req;
  res.setHeader('etag', generateWeakETag(res.getHeader('content-encoding'), file.stats));
  res.setHeader('last-modified', file.stats.mtime.toUTCString());
}
