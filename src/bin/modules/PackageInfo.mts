import { access, constants, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Queue } from '../../index.mts';

export interface PackageInfo {
  isRoot: boolean;
  id: string;
  dir: string;
  packageJson: PackageJson;
  dependencies: Map<string, string>;
  getFilePaths: () => Promise<Set<string>> | Set<string>;
}

export interface PackageJson {
  name: string;
  version?: string;
  main?: string;
  browser?: string;
  module?: string;
  exports?: MaybeArray<ImportMapping>;
  imports?: { [id: string]: MaybeArray<ImportMapping> };
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

export type MaybeArray<T> = T | T[];
export type ImportMapping =
  | { [condition: string]: MaybeArray<ImportMapping> | undefined }
  | string
  | null;

export async function readPackageGraph(packageJsonPath: string): Promise<PackageInfo[]> {
  const inputStat = await stat(packageJsonPath);
  if (inputStat.isDirectory()) {
    packageJsonPath = join(packageJsonPath, 'package.json');
  } else if (!inputStat.isFile()) {
    throw new Error(`invalid package.json path: ${packageJsonPath}`);
  }
  const rootPackage = await readPackage(await realpath(packageJsonPath));
  rootPackage.isRoot = true;
  const seenIDs = new Set([rootPackage.id]);
  const allPackages = [rootPackage];

  for (const pkg of allPackages) {
    const dependencies = new Map<string, boolean>();
    for (const name of Object.keys(pkg.packageJson['peerDependencies'] ?? {})) {
      dependencies.set(name, false);
    }
    for (const [name, meta] of Object.entries(pkg.packageJson['peerDependenciesMeta'] ?? {})) {
      if (dependencies.has(name)) {
        dependencies.set(name, meta.optional ?? false);
      }
    }
    for (const name of Object.keys(pkg.packageJson['optionalDependencies'] ?? {})) {
      dependencies.set(name, true);
    }
    for (const name of Object.keys(pkg.packageJson['dependencies'] ?? {})) {
      dependencies.set(name, false);
    }
    const resolveSource = join(pkg.dir, 'a.js');
    await Promise.all(
      [...dependencies].map(async ([name, optional]) => {
        const dep = await readDependencyPackage(name, resolveSource);
        if (!dep) {
          if (optional) {
            return;
          }
          throw new Error(`package ${name} not found (required by ${pkg.dir})`);
        }
        if (!seenIDs.has(dep.id)) {
          seenIDs.add(dep.id);
          allPackages.push(dep);
        }
        pkg.dependencies.set(name, dep.id);
      }),
    );
  }
  return allPackages;
}

export const getResolvedExportMap = (packageJson: PackageJson, env: Set<string>) =>
  resolveMappings(getNormalisedExports(packageJson), env);

export const getResolvedImportMap = (packageJson: PackageJson, env: Set<string>) =>
  resolveMappings(packageJson.imports ?? {}, env);

function getNormalisedExports(
  packageJson: PackageJson,
): Record<string, MaybeArray<ImportMapping> | undefined> {
  const exp = packageJson.exports;
  if (exp === undefined) {
    return {
      '.': {
        browser: packageJson.browser,
        module: packageJson.module,
        default: packageJson.main ?? './index.js',
      },
      './*': './*',
    };
  }
  if (Array.isArray(exp) || typeof exp !== 'object' || !exp) {
    return { '.': exp };
  }
  for (const id of Object.keys(exp)) {
    if (id.startsWith('.')) {
      return exp;
    }
  }
  return { '.': exp };
}

function resolveMappings(
  mappings: Record<string, MaybeArray<ImportMapping> | undefined>,
  env: Set<string>,
) {
  const result = new Map<string, string | null>();
  for (const [id, mapping] of Object.entries(mappings)) {
    const target = resolveMapping(mapping, env);
    if (target !== undefined) {
      result.set(id, target);
    }
  }
  return result;
}

function resolveMapping(
  mapping: MaybeArray<ImportMapping> | undefined,
  env: Set<string>,
): string | null | undefined {
  if (typeof mapping === 'string' || mapping === null) {
    return mapping;
  }
  if (Array.isArray(mapping)) {
    for (const item of mapping) {
      const resolved = resolveMapping(item, env);
      if (resolved) {
        return resolved;
      }
    }
    return undefined;
  }
  if (mapping) {
    for (const [condition, value] of Object.entries(mapping)) {
      if (condition === 'default' || env.has(condition)) {
        const resolved = resolveMapping(value, env);
        if (resolved) {
          return resolved;
        }
      }
    }
  }
  return undefined;
}

const readPackage = async (
  packageJsonPath: string,
  dir = dirname(packageJsonPath),
): Promise<PackageInfo> => ({
  isRoot: false,
  id: packageJsonPath,
  dir,
  packageJson: JSON.parse(await readFile(packageJsonPath, { encoding: 'utf-8' })),
  dependencies: new Map(),
  getFilePaths: () => getFilePaths(dir),
});

async function getFilePaths(dir: string) {
  const paths = new Set<string>();
  const pathsQueue = new Queue({ _dir: dir, _path: '.' });
  for (const base of pathsQueue) {
    for (const f of await readdir(base._dir, { withFileTypes: true, encoding: 'utf-8' })) {
      if (f.name.startsWith('.')) {
        continue;
      }
      if (f.isFile()) {
        paths.add(`${base._path}/${f.name}`);
      } else if (f.isDirectory() && f.name !== 'node_modules') {
        pathsQueue.push({ _dir: join(base._dir, f.name), _path: `${base._path}/${f.name}` });
      }
    }
  }
  return paths;
}

async function readDependencyPackage(name: string, base: string): Promise<PackageInfo | null> {
  const baseURL = base && pathToFileURL(base);
  try {
    return await readPackage(fileURLToPath(import.meta.resolve(name + '/package.json', baseURL)));
  } catch {}
  try {
    const pkg = await readNearestPackage(
      dirname(fileURLToPath(import.meta.resolve(name, baseURL))),
    );
    if (pkg.packageJson.name === name) {
      return pkg;
    }
  } catch {}
  return null;
}

async function readNearestPackage(dir: string): Promise<PackageInfo> {
  const seen = new Set(['', sep]);
  for (
    let curDir = await realpath(dir, { encoding: 'utf-8' });
    !seen.has(curDir);
    curDir = dirname(curDir)
  ) {
    seen.add(curDir);
    const file = join(curDir, 'package.json');
    try {
      await access(file, constants.R_OK);
      return await readPackage(file);
    } catch {}
  }
  throw new Error(`package.json not found in ${dir} or any parent folder`);
}
