import type { MaybePromise } from '../../util/MaybePromise.mts';
import {
  getResolvedExportMap,
  getResolvedImportMap,
  type PackageInfo,
  type PackageJson,
} from './PackageInfo.mts';

// References:
// https://nodejs.org/api/packages.html
// https://nodejs.org/api/esm.html#resolution-algorithm-specification
// https://nodejs.org/api/module.html#modulefindpackagejsonspecifier-base
// https://html.spec.whatwg.org/multipage/webappapis.html#import-maps

export async function generateImportMap(
  packages: PackageInfo[],
  env: Set<string>,
  basePath: string,
  rootPackagePath: string,
  packageToPath: (packageJson: PackageJson, dir: string) => string,
): Promise<{ hostedDirs: { dir: string; path: string }[]; importMap: ImportMap }> {
  if (basePath.endsWith('/')) {
    basePath = basePath.substring(0, basePath.length - 1);
  }
  if (rootPackagePath.endsWith('/')) {
    rootPackagePath = rootPackagePath.substring(0, rootPackagePath.length - 1);
  }
  const seenPaths = new Set<string>();
  const packageMapping = new Map<string, TempImportExportInfo>();
  const augmentedPackages = packages.map((pkg) => {
    const path = packageToPath(pkg.packageJson, pkg.dir);
    let uniquePath = path;
    for (let n = 2; seenPaths.has(uniquePath); ++n) {
      uniquePath = `${path}_${n}`;
    }
    seenPaths.add(uniquePath);
    const o: TempImportExportInfo = {
      _packageInfo: pkg,
      _exports: [],
      _absPathEncoded: pkg.isRoot ? rootPackagePath : `${basePath}/${encodeURIPath(uniquePath)}`,
      _relPath: uniquePath,
    };
    packageMapping.set(pkg.id, o);
    return o;
  });

  await Promise.all(
    augmentedPackages.map(async (pkg) => {
      pkg._exports = await resolveMapping(
        getResolvedExportMap(pkg._packageInfo.packageJson, env),
        async () => (pkg._cachedFiles ??= await pkg._packageInfo.getFilePaths()),
        (id) => id === '.' || id.startsWith('./'),
        (target) => target.startsWith('./'),
      );
    }),
  );

  const hostedDirs: { dir: string; path: string }[] = [];
  let baseImports = new Map<string, string | null>();
  const scopes: Entry<string, Map<string, string | null>>[] = [];
  for (const pkg of augmentedPackages) {
    const imports = new Map<string, string | null>();
    if (pkg._packageInfo.packageJson.name && pkg._packageInfo.packageJson.exports) {
      addMappings(imports, pkg._exports, pkg._packageInfo.packageJson.name, pkg._absPathEncoded);
    }
    for (const [depName, depID] of pkg._packageInfo.dependencies) {
      const depPkg = packageMapping.get(depID);
      if (!depPkg) {
        throw new Error('internal reference mismatch');
      }
      addMappings(imports, depPkg._exports, depName, depPkg._absPathEncoded);
    }
    const importMappings = await resolveMapping(
      getResolvedImportMap(pkg._packageInfo.packageJson, env),
      async () => {
        pkg._cachedFiles ??= await pkg._packageInfo.getFilePaths();
        return new Set([...imports.keys(), ...pkg._cachedFiles]);
      },
      (id) => id.startsWith('#') && id.length > 1,
      (target) => target.startsWith('./') || !target.startsWith('.'),
    );
    for (const [importID, target] of importMappings) {
      if (!target) {
        imports.set(importID, null);
        continue;
      }
      const resolved = imports.get(target);
      if (resolved !== undefined) {
        imports.set(importID, resolved);
      } else if (target.startsWith('./')) {
        imports.set(importID, pkg._absPathEncoded + encodeURIPath(target.substring(1)));
      } else {
        throw new Error(`unable to resolve import ${target}`);
      }
    }
    const importMap = imports;
    if (pkg._packageInfo.isRoot) {
      baseImports = importMap;
    } else {
      hostedDirs.push({ dir: pkg._packageInfo.dir, path: pkg._relPath });
      scopes.push([pkg._absPathEncoded + '/', importMap]);
    }
  }
  const scopesOut: Entry<string, ModuleSpecifierMap>[] = [];
  // optimisation: remove mappings from scoped sections if they are already covered by the root
  for (const [scope, mapping] of scopes) {
    for (const [k, v] of baseImports) {
      if (mapping.get(k) === v) {
        mapping.delete(k);
      }
    }
    if (mapping.size) {
      scopesOut.push([scope, renderModuleSpecifierMap(mapping)]);
    }
  }
  return {
    hostedDirs,
    importMap: {
      imports: renderModuleSpecifierMap(baseImports),
      scopes: Object.fromEntries(scopesOut),
    },
  };
}

function addMappings(
  output: Map<string, string | null>,
  mappings: Entry<string, string | null>[],
  inPrefix: string,
  outPrefix: string,
) {
  for (const [exportID, target] of mappings) {
    output.set(
      inPrefix + exportID.substring(1),
      target ? outPrefix + encodeURIPath(target.substring(1)) : null,
    );
  }
}

function renderModuleSpecifierMap(mapping: Map<string, string | null>): ModuleSpecifierMap {
  return Object.fromEntries([...mapping.entries()].map(([k, v]) => [encodeURIPath(k), v]));
}

export async function resolveMapping(
  mappings: Map<string, string | null>,
  getTargetPaths: () => MaybePromise<Set<string>>,
  idValidator: (v: string) => boolean,
  targetValidator: (v: string) => boolean,
): Promise<Entry<string, string | null>[]> {
  const staticMappings = new Map<string, { _target: string | null; _specificity: Specificity }>();
  const wildcardMappings: {
    _id: WildcardPattern;
    _target: WildcardPattern;
    _specificity: Specificity;
  }[] = [];
  const wildcardNullMappings: { _id: WildcardPattern; _specificity: Specificity }[] = [];

  for (const [id, target] of mappings) {
    const idWild = id.indexOf('*');
    const targetWild = target?.indexOf('*') ?? -1;
    if (
      !idValidator(id) ||
      (target !== null && (!targetValidator(target) || (targetWild !== -1) !== (idWild !== -1)))
    ) {
      throw new Error(`invalid entry: ${JSON.stringify(id)} => ${JSON.stringify(target)}`);
    }
    if (idWild !== -1) {
      const idCheck: WildcardPattern = [
        id.length - 1,
        id.substring(0, idWild),
        id.substring(idWild + 1),
      ];
      const specificity: Specificity = [idWild, id.length];
      if (target) {
        wildcardMappings.push({
          _id: idCheck,
          _target: [
            target.length - 1,
            target.substring(0, targetWild),
            target.substring(targetWild + 1),
          ],
          _specificity: specificity,
        });
      } else {
        wildcardNullMappings.push({ _id: idCheck, _specificity: specificity });
      }
    } else {
      staticMappings.set(id, { _target: target, _specificity: [-1, 0] });
    }
  }

  if (wildcardMappings.length) {
    const paths = await getTargetPaths();
    for (const path of paths) {
      for (const map of wildcardMappings) {
        const match = matchPattern(map._target, path);
        if (match !== false) {
          const id = map._id[1] + match + map._id[2];
          const existing = staticMappings.get(id);
          if (!existing || cmpSpecificity(map._specificity, existing._specificity) < 0) {
            staticMappings.set(id, { _target: path, _specificity: map._specificity });
          }
        }
      }
    }
  }

  for (const pattern of wildcardNullMappings) {
    for (const [id, mapping] of staticMappings) {
      if (
        mapping._target !== null &&
        cmpSpecificity(pattern._specificity, mapping._specificity) < 0 &&
        matchPattern(pattern._id, id)
      ) {
        mapping._target = null;
      }
    }
  }

  return [...staticMappings].map(([id, mapping]) => [id, mapping._target]);
}

type WildcardPattern = [number, string, string];
type Specificity = [number, number];

const matchPattern = (pattern: WildcardPattern, candidate: string): string | false =>
  candidate.length >= pattern[0] &&
  candidate.startsWith(pattern[1]) &&
  candidate.endsWith(pattern[2])
    ? candidate.substring(pattern[1].length, candidate.length - pattern[2].length)
    : false;

const cmpSpecificity = (a: Specificity, b: Specificity) => a[0] - b[0] || a[1] - b[1];

type ModuleSpecifierMap = Record<string, string | null>;

interface ImportMap {
  imports?: ModuleSpecifierMap;
  integrity?: Record<string, string>;
  scopes?: Record<string, ModuleSpecifierMap>;
}

interface TempImportExportInfo {
  _packageInfo: PackageInfo;
  _exports: Entry<string, string | null>[];
  _cachedFiles?: Set<string>;
  _absPathEncoded: string;
  _relPath: string;
}

const encodeURIPath = (v: string) =>
  encodeURIComponent(v).replaceAll(/%2f/gi, '/').replaceAll(/%40/g, '@').replaceAll(/%23/g, '#');

type Entry<Key, Value> = [Key, Value];
