import { constants, open, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import type { IncomingHttpHeaders } from 'node:http';
import {
  FileFinderRules,
  type FileFinder,
  type FileFinderOptions,
  type ResolvedFileInfo,
} from './FileFinder.mts';

export const dynamicFileFinder = async (
  baseDir: string,
  options: FileFinderOptions = {},
): Promise<FileFinder> =>
  new DynamicFileFinder(await internalResolveAbsDir(baseDir), new FileFinderRules(options));

export class DynamicFileFinder implements FileFinder {
  /** @internal */ declare private readonly _baseDir: string;
  /** @internal */ declare private readonly _rules: FileFinderRules;

  /** @internal */ constructor(baseDir: string, rules: FileFinderRules) {
    this._baseDir = baseDir;
    this._rules = rules;
  }

  get isStaticListing() {
    return false;
  }

  toNormalisedPath(pathParts: ReadonlyArray<string>) {
    return this._rules._toNormalisedPath(pathParts);
  }

  /**
   * Find a file which matches the path.
   *
   * Note that the returned value contains an active `FileHandle`, which must be closed.
   *
   * @param pathParts the request path, split into separate components
   * @param negotiation any client-sent negotiation options to apply
   * @returns details about the resolved file (including an active `FileHandle`), or `null`
   */
  async find(
    pathParts: ReadonlyArray<string>,
    reqHeaders: IncomingHttpHeaders = {},
    warnings?: string[] | undefined,
  ): Promise<ResolvedFileInfo | null> {
    const isDir = Boolean(pathParts.length && !pathParts[pathParts.length - 1]);
    if (isDir) {
      pathParts = pathParts.slice(0, pathParts.length - 1);
    }
    if (pathParts.some((part) => part.includes(sep))) {
      warnings?.push(`${JSON.stringify(pathParts)} contains encoded ${sep}`);
      return null;
    }
    let subPath = pathParts.join(sep);
    if (this._rules._caseSensitive === 'force-lowercase') {
      subPath = subPath.toLowerCase();
    }
    if (/(^|[\\\/])\.\.($|[\\\/])|^[\\\/]/.test(subPath)) {
      warnings?.push(`${JSON.stringify(subPath)} is not permitted`);
      return null; // attempted directory traversal (may reveal root directory): fail
    }
    let resolvedPath = resolve(this._baseDir, subPath);
    if (!resolvedPath.startsWith(this._baseDir) && resolvedPath + sep !== this._baseDir) {
      warnings?.push(
        `${JSON.stringify(resolvedPath)} is not inside root ${JSON.stringify(this._baseDir)}`,
      );
      return null; // directory traversal escaped root directory: fail
    }

    let parts: string[] | null = null;
    let realPath: string | null = null;
    for (const suffix of this._rules._implicitSuffixes) {
      if (isDir && suffix) {
        continue;
      }
      const suffixedPath = resolvedPath + suffix;
      parts = suffixedPath
        .substring(this._baseDir.length)
        .split(sep)
        .filter((part) => part);
      if (parts.length - 1 > this._rules._subDirectories) {
        warnings?.push(
          `${JSON.stringify(resolvedPath)} is nested too deeply (${parts.length - 1} > ${this._rules._subDirectories})`,
        );
        return null; // requested path is too deep for our config: fail
      }
      if (parts.some((p) => !this._rules._checkPermitted(p))) {
        warnings?.push(`${JSON.stringify(resolvedPath)} is not permitted`);
        return null; // part of the requested path involves a file which we do not permit access to: fail
      }
      const name = parts[parts.length - 1] ?? '';
      if (
        !isDir &&
        !this._rules._allowDirectIndexAccess &&
        this._rules._indexFilesSet.has(this._rules._normalise(name)) &&
        !this._rules._allow.has(this._rules._normalise(name))
      ) {
        warnings?.push(`${JSON.stringify(resolvedPath)} is a hidden index file`);
        return null; // requested an index file by name, denied by config: fail
      }
      realPath = await realpath(suffixedPath, { encoding: 'utf-8' }).catch(() => null);
      if (realPath) {
        resolvedPath = suffixedPath;
        break;
      }
    }
    if (!realPath || !parts) {
      warnings?.push(`file ${JSON.stringify(resolvedPath)} does not exist`);
      return null; // requested path does not exist: fail
    }
    if (this._rules._normalise(realPath) !== this._rules._normalise(resolvedPath)) {
      warnings?.push(
        `realpath ${JSON.stringify(realPath)} does not match request ${JSON.stringify(resolvedPath)}`,
      );
      return null; // real path turned out to be different (e.g. a symlink): fail
    }

    let canonicalPath = realPath;
    let stats = await stat(realPath).catch(() => null);
    if (!stats) {
      warnings?.push(`file ${JSON.stringify(realPath)} does not exist`);
      return null; // requested path does not exist: fail
    }
    if (stats.isDirectory()) {
      if (parts.length > this._rules._subDirectories) {
        warnings?.push(
          `${JSON.stringify(realPath)} index file is nested too deeply (${parts.length} > ${this._rules._subDirectories})`,
        );
        return null; // requested path is a directory and is too deep for our config to look for an index file: fail
      }
      for (const attempt of this._rules._indexFiles) {
        const indexPath = join(realPath, attempt);
        stats = await stat(indexPath).catch(() => null);
        if (stats?.isFile()) {
          canonicalPath = indexPath;
          break;
        }
      }
    } else if (isDir) {
      warnings?.push(`${JSON.stringify(realPath)} exists but is not a directory`);
      return null;
    }
    if (!stats?.isFile()) {
      warnings?.push(`${JSON.stringify(realPath)} exists but is not a file`);
      return null;
    }

    const base = basename(canonicalPath);
    if (!this._rules._negotiator) {
      return internalTryReturn(canonicalPath, { canonicalFilename: base, headers: {} }, warnings);
    }

    const dir = dirname(canonicalPath);
    for (const option of this._rules._negotiator.options(base, reqHeaders)) {
      if (!option.filename || option.filename.includes(sep)) {
        continue;
      }
      const result = await internalTryReturn(
        join(dir, option.filename),
        { canonicalFilename: base, headers: option.headers },
        warnings,
      );
      if (result) {
        return result;
      }
    }
    return null;
  }
}

export const internalResolveAbsDir = async (dir: string) =>
  (await realpath(resolve(process.cwd(), dir), { encoding: 'utf-8' })) + sep;

export async function internalTryReturn(
  path: string,
  details: Omit<ResolvedFileInfo, 'handle' | 'stats' | 'filesystemPath'>,
  warnings: string[] | undefined,
): Promise<ResolvedFileInfo | null> {
  const handle = await open(path, constants.O_RDONLY).catch(() => null);
  if (!handle) {
    warnings?.push(`failed to open ${JSON.stringify(path)}`);
    return null;
  }
  const fail = () => {
    handle.close().catch(() => {});
    return null;
  };
  // open() also succeeds for directories and various other
  // types of node, so we must confirm this is a file:
  const stats = await handle.stat().catch(fail);
  if (!stats?.isFile()) {
    warnings?.push(`${JSON.stringify(path)} exists but is not a file`);
    return fail();
  }
  return { handle, stats, filesystemPath: path, ...details };
}
