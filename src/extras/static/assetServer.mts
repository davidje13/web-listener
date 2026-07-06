import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname } from 'node:path';
import { CONTINUE } from '../../core/RoutingInstruction.mts';
import type { RequestHandler } from '../../core/handler.mts';
import { HTTPError } from '../../core/HTTPError.mts';
import type { MaybePromise } from '../../util/MaybePromise.mts';
import { internalNormaliseHeaders, type AnyHeaders } from '../../util/normaliseHeaders.mts';
import { getRemainingPathComponents } from '../request/pathComponents.mts';
import { sendFile } from '../response/sendFile.mts';
import { internalAddVary, internalSetContentEncoding } from '../response/setHeaders.mts';
import { generateWeakETag } from '../cache/etag.mts';
import { emitError } from '../error/emitError.mts';
import { getMime } from '../registries/mime.mts';
import type { FileFinder, ResolvedFileInfo } from '../filesystem/FileFinder.mts';

export interface AssetServerOptions {
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
  verbose?: boolean | undefined;

  /**
   * Static headers to set on all responses.
   */
  headers?: AnyHeaders | undefined;

  /**
   * A list of dynamic headers to generate for responses. Note that headers specified in
   * `headers` or set by `callback` will override the dynamically generated values. Set to an
   * empty list or `false` to disable all dynamic headers.
   *
   * Equivalent to the following code in `callback`:
   *
   *  ```
   *  res.setHeader('etag', generateWeakETag(res.getHeader('content-encoding'), file.stats));
   *  res.setHeader('last-modified', file.stats.mtime.toUTCString());
   *  ```
   *
   * @default ['etag', 'last-modified']
   */
  dynamicHeaders?: ReadonlyArray<'etag' | 'last-modified'> | false | undefined;

  /**
   * A function to call when a file is being served. Can modify headers in the response.
   *
   * This function is called after the `Content-Type`, `Content-Encoding`, and any configured
   * dynamic headers have been set, so you can inspect those or change them if you want to set
   * different values.
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
 * Set up a server for static files. The options are secure by default.
 * Requests for files which are not permitted or do not exist will return NEXT_ROUTE and can be
 * handled by subsequent routes.
 *
 * @param source a FileFinder providing files to serve as assets
 * @param options custom configuration to apply
 * @returns a server handler function
 */
export const assetServer = (
  source: FileFinder,
  {
    fallback,
    verbose,
    headers,
    dynamicHeaders = ['etag', 'last-modified'],
    callback,
  }: AssetServerOptions = {},
): RequestHandler => {
  let fallbackPath: ReadonlyArray<string> | null = null;
  const fallbackStatusCode = fallback?.statusCode ?? 200;
  if (fallback) {
    let path = fallback.filePath;
    if (path.startsWith('/')) {
      path = path.substring(1);
    }
    fallbackPath = source.toNormalisedPath(path.split('/'));
  }

  const pathOptions = { rejectPotentiallyUnsafe: !source.isStaticListing };

  const normHeaders = internalNormaliseHeaders(headers);
  const dHeaders = new Set((dynamicHeaders || []).map((v) => v.toLowerCase()));
  for (const h of normHeaders.keys()) {
    dHeaders.delete(h);
  }

  return {
    handleRequest: async (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return CONTINUE;
      }
      let isFallback = false;
      const path = getRemainingPathComponents(req, pathOptions);
      const warnings: string[] = [];
      let file = await source.find(path, req.headers, verbose ? warnings : undefined);
      if (!file) {
        if (!fallbackPath) {
          if (verbose) {
            emitError(req, new Error(warnings.join(', ')), 'serving static content');
          }
          return CONTINUE;
        }
        isFallback = true;
        file = await source.find(fallbackPath, req.headers, warnings);
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

        const contentType =
          file.headers['content-type'] ?? getMime(extname(file.canonicalFilename));
        res.setHeader('content-type', contentType);

        const contentLanguage = file.headers['content-language'];
        if (contentLanguage) {
          res.setHeader('content-language', contentLanguage);
        }

        internalSetContentEncoding(res, file.headers['content-encoding']);
        internalAddVary(res, file.headers.vary);

        res.setHeaders(normHeaders);
        if (dHeaders.has('etag')) {
          res.setHeader('etag', generateWeakETag(res.getHeader('content-encoding'), file.stats));
        }
        if (dHeaders.has('last-modified')) {
          res.setHeader('last-modified', file.stats.mtime.toUTCString());
        }
        await callback?.(req, res, file, isFallback);
        await sendFile(req, res, file.handle, file.stats);
      } finally {
        file.handle.close().catch(() => {});
      }
      return;
    },
  };
};
