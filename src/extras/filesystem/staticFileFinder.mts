import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Queue } from '../../util/Queue.mts';
import { internalResolveAbsDir, internalTryReturn } from './dynamicFileFinder.mts';
import {
  FileFinderRules,
  type FileFinder,
  type FileFinderOptions,
  type ResolvedFileInfo,
} from './FileFinder.mts';

export async function staticFileFinder(
  baseDir: string,
  options: FileFinderOptions = {},
): Promise<FileFinder & { staticPaths: () => Set<string> }> {
  const root = await internalResolveAbsDir(baseDir);

  const rules = new FileFinderRules(options);
  const precomputed = new StaticFileFinder(rules, internalTryReturn);

  const queue = new Queue<string[]>([]);
  for (const path of queue) {
    const dirEntries = await readdir(join(root, ...path), {
      withFileTypes: true,
      encoding: 'utf-8',
    });
    const siblings = new Map(
      dirEntries.map((v) => [rules._normalise(v.name), join(root, ...path, v.name)]),
    );
    for (const file of dirEntries) {
      if (rules._checkPermitted(file.name)) {
        if (file.isDirectory()) {
          const dirPath = [...path, file.name];
          precomputed._addDir(dirPath);
          if (path.length < rules._subDirectories) {
            queue.push(dirPath);
          }
        } else if (file.isFile()) {
          precomputed._addFile(path, file.name, join(root, ...path, file.name), siblings);
        }
      }
    }
  }
  return precomputed;
}

type Responder<T> = (
  found: T,
  details: Omit<ResolvedFileInfo, 'handle' | 'stats' | 'filesystemPath'>,
  warnings: string[] | undefined,
) => Promise<ResolvedFileInfo | null>;

export class StaticFileFinder<T> implements FileFinder {
  /** @internal */ declare private readonly _lookup: Map<string, StaticFileInfo<T>>;
  /** @internal */ declare private readonly _rules: FileFinderRules;
  /** @internal */ declare private readonly _responder: Responder<T>;

  get isStaticListing() {
    return true;
  }

  /** @internal */ constructor(rules: FileFinderRules, responder: Responder<T>) {
    this._lookup = new Map();
    this._rules = rules;
    this._responder = responder;
  }

  /** @internal */ private _set(path: string, info: StaticFileInfo<T>) {
    const existing = this._lookup.get(path);
    if (!existing || info.p > existing.p) {
      this._lookup.set(path, info);
    }
  }

  /** @internal */ _addFile(
    path: ReadonlyArray<string>,
    filename: string,
    data: T,
    siblings: Map<string, T>,
  ) {
    const normFileName = this._rules._normalise(filename);
    const entity: Omit<StaticFileInfo<T>, 'p'> = { data, basename: normFileName, siblings };
    const indexPos = this._rules._indexFiles.indexOf(normFileName);
    if (indexPos !== -1) {
      this._set(this._rules._normalise(path.join('/')), {
        ...entity,
        p: this._rules._indexFiles.length + 1 - indexPos,
      });
      if (!this._rules._allowDirectIndexAccess && !this._rules._allow.has(normFileName)) {
        return;
      }
    }
    const fullPath = this._rules._normalise([...path, filename].join('/'));
    for (let i = 0; i < this._rules._implicitSuffixes.length; ++i) {
      const suffix = this._rules._implicitSuffixes[i]!;
      if (filename.endsWith(suffix)) {
        this._set(fullPath.substring(0, fullPath.length - suffix.length), { ...entity, p: -i });
      }
    }
  }

  /** @internal */ _addDir(path: ReadonlyArray<string>) {
    this._set(this._rules._normalise(path.join('/')), DIR);
  }

  toNormalisedPath(pathParts: ReadonlyArray<string>) {
    return this._rules._toNormalisedPath(pathParts);
  }

  async find(path: ReadonlyArray<string>, reqHeaders = {}, warnings: string[] | undefined) {
    const entity = this._lookup.get(this._rules._normalise(path.join('/')));
    if (!entity || entity.data === undefined) {
      warnings?.push(`${JSON.stringify(path.join('/'))} not found in static file paths`);
      return null;
    }
    if (!this._rules._negotiator) {
      return this._responder(
        entity.data,
        { canonicalFilename: entity.basename, headers: {} },
        warnings,
      );
    }
    for (const option of this._rules._negotiator.options(entity.basename, reqHeaders)) {
      const sibling = entity.siblings.get(this._rules._normalise(option.filename));
      if (sibling === undefined) {
        continue;
      }
      const result = await this._responder(
        sibling,
        { canonicalFilename: entity.basename, headers: option.headers },
        warnings,
      );
      if (result) {
        return result;
      }
    }
    return null;
  }

  staticPaths() {
    return new Set([...this._lookup].filter(([_, v]) => v.basename).map(([k]) => k));
  }
}

interface StaticFileInfo<T> {
  data: T | undefined;
  basename: string;
  siblings: Map<string, T>;
  p: number;
}

const DIR: StaticFileInfo<never> = {
  data: undefined,
  basename: '',
  siblings: new Map<string, never>(),
  p: 1,
};
