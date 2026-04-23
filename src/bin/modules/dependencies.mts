import {
  fileServer,
  Router,
  staticContent,
  type FileServerOptions,
  type RequestHandler,
  type StaticContentOptions,
} from '../../index.mts';
import { generateImportMap } from './generateImportMap.mts';
import { readPackageGraph, type PackageJson } from './PackageInfo.mts';

export interface DependencyHandlerOptions extends Omit<
  FileServerOptions,
  'indexFiles' | 'implicitSuffixes' | 'allowDirectIndexAccess'
> {
  environment?: string[];
  mapFilePath?: string | false;
  sourcesBasePath?: string;
  modulesBasePath?: string;
}

export async function dependencies(
  packageJsonPath: string,
  {
    environment = ['browser', 'import', 'production'],
    mapFilePath = '/importmap.json',
    sourcesBasePath = '',
    modulesBasePath = '/node_modules',
    ...fileServerOptions
  }: DependencyHandlerOptions,
): Promise<RequestHandler> {
  const router = new Router();

  const map = await generateImportMap(
    await readPackageGraph(packageJsonPath),
    new Set(environment),
    modulesBasePath,
    sourcesBasePath,
    flatModules,
  );

  for (const { dir, subPath } of map.packages) {
    if (subPath) {
      router.mount(
        '/' + subPath,
        await fileServer(dir, {
          ...fileServerOptions,
          hide: [...(fileServerOptions.hide ?? []), 'node_modules'],
          indexFiles: [],
        }),
      );
    }
  }
  const importMapJSON = JSON.stringify(map.importMap);
  if (mapFilePath) {
    const options: StaticContentOptions = {
      headers: fileServerOptions.headers,
      encodings: ['br', 'gzip'],
      minCompression: 100,
    };

    router.get(
      mapFilePath,
      staticContent(Buffer.from(importMapJSON, 'utf-8'), 'application/importmap+json', options),
    );

    // this script version can be loaded from HTML pages (workaround for browsers only supporting inline import maps)
    router.get(
      mapFilePath + '.js',
      staticContent(
        Buffer.from(
          `const s=document.createElement('script');s.type='importmap';s.textContent=JSON.stringify(${importMapJSON});document.head.append(s);`,
          'utf-8',
        ),
        'text/javascript; charset=utf-8',
        options,
      ),
    );
  }

  return Object.assign(router, { importMapJSON });
}

const flatModules = (packageJson: PackageJson) =>
  (packageJson.name || '-') + (packageJson.version ? `@${packageJson.version}` : '');
