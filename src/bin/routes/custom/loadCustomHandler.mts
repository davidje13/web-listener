import { registerHooks } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { closeSync, openSync, readSync, constants } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import type { ErrorHandler, HandlerResult, RequestHandler, ZipFile } from '../../../index.mts';
import { findZipPath, readZipPath } from '../../zipCache.mts';

const EXTENSION_FORMATS = new Map([
  ['.mjs', 'module'],
  ['.cjs', 'commonjs'],
  ['.mts', 'module-typescript'],
  ['.cts', 'commonjs-typescript'],
  ['.json', 'json'],
  ['.wasm', 'wasm'],
]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'web-listener') {
      // ensure custom routes get our own index.js file when importing web-listener
      // (to avoid problems with duplicate classes, increased memory, etc.)
      specifier = join(dirname(fileURLToPath(import.meta.url)), 'index.js');
    } else {
      const url = URL.parse(specifier, context.parentURL);
      if (url && url.protocol === 'file:') {
        // allow loading sources from a .zip archive
        if (findZipPath(fileURLToPath(url))) {
          return {
            url: url.toString(),
            format: EXTENSION_FORMATS.get(extname(url.pathname)),
            shortCircuit: true,
          };
        }
      }
    }
    return nextResolve(specifier, context);
  },

  load(url, context, nextLoad) {
    if (url.startsWith('file://')) {
      const path = fileURLToPath(url);
      const zipFile = findZipPath(path);
      if (zipFile && !zipFile.isDirectory) {
        const source = readZipFileSync(zipFile);
        return {
          source,
          format: EXTENSION_FORMATS.get(extname(path)) ?? 'commonjs',
          shortCircuit: true,
        };
      }
    }
    return nextLoad(url, context);
  },
});

const LOADED = new Set();
const LOADED_THIS_TIME = new Set();

export function markImportingDone() {
  for (const path of LOADED_THIS_TIME) {
    LOADED.add(path);
  }
  LOADED_THIS_TIME.clear();
}

export async function loadCustomHandler(
  path: string,
  namedExport: string | null,
  warn: (message: string) => void,
): Promise<AnyHandler> {
  if (!LOADED_THIS_TIME.has(path)) {
    if (LOADED.has(path)) {
      // it is not currently possible to force-reload a module
      // after it has been imported, so warn the user instead:
      warn(`${path} has already been loaded into the module cache and will not be updated`);
    }
    LOADED_THIS_TIME.add(path);
  }

  await readZipPath(path, true); // load hook is synchronous, so we must open the zip (asynchronously) upfront
  const mod = await import(path);
  const handler = mod?.[namedExport || 'default'];
  if (!handler || (typeof handler !== 'function' && typeof handler !== 'object')) {
    throw new Error(
      `${path} must export a request handler ${namedExport ? `named ${JSON.stringify(namedExport)}` : 'as default'}`,
    );
  }
  return handler;
}

type AnyHandler =
  | RequestHandler
  | ErrorHandler
  | ((req: IncomingMessage, res: ServerResponse) => HandlerResult | Promise<HandlerResult>);

export function readZipFileSync(file: ZipFile): Buffer {
  const meta = file.meta();
  if (!meta.s) {
    return Buffer.alloc(0);
  }
  const raw = Buffer.alloc(meta.s);
  const fd = openSync(file.zipFilePath, constants.O_RDONLY);
  try {
    if (readSync(fd, raw, 0, meta.s, meta.p) !== meta.s) {
      throw new Error('zip content has changed');
    }
    if (meta.z) {
      return inflateRawSync(raw, { maxOutputLength: file.stat().size });
    } else {
      return raw;
    }
  } finally {
    closeSync(fd);
  }
}
