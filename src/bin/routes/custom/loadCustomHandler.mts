import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ErrorHandler, HandlerResult, RequestHandler } from '../../../index.mts';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'web-listener') {
      // ensure custom routes get our own index.js file when importing web-listener
      // (to avoid problems with duplicate classes, increased memory, etc.)
      specifier = join(dirname(new URL(import.meta.url).pathname), 'index.js');
    }
    return nextResolve(specifier, context);
  },
});

const LOADED = new Set();

export async function loadCustomHandler(
  path: string,
  warn: (message: string) => void,
): Promise<AnyHandler> {
  if (LOADED.has(path)) {
    // it is not currently possible to force-reload a module
    // after it has been imported, so warn the user instead:
    warn(`${path} has already been loaded into the module cache and will not be updated`);
  } else {
    LOADED.add(path);
  }

  const mod = await import(path);
  const handler = mod?.default;
  if (!handler || (typeof handler !== 'function' && typeof handler !== 'object')) {
    throw new Error(`${path} must "export default" a request handler`);
  }
  return handler;
}

type AnyHandler =
  | RequestHandler
  | ErrorHandler
  | ((req: IncomingMessage, res: ServerResponse) => HandlerResult | Promise<HandlerResult>);
