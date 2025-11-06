import type { IncomingMessage, ServerResponse } from 'node:http';
import { addTeardown, CONTINUE, fileServer, proxy, requestHandler, Router } from '../index.mts';
import type { ConfigMount } from './config/types.mts';

export interface LogInfo {
  method: string;
  path: string;
  status: number;
  duration: number;
}

export async function buildRouter(mount: ConfigMount[], log: (info: LogInfo) => void = () => {}) {
  const router = new Router();
  router.use(
    requestHandler((req, res) => {
      const tm0 = Date.now();
      addTeardown(req, () => {
        const duration = Date.now() - tm0;
        log({
          method: req.method ?? 'GET',
          path: req.url ?? '/',
          status: res.statusCode,
          duration,
        });
      });
      return CONTINUE;
    }),
  );
  for (const item of mount) {
    switch (item.type) {
      case 'files':
        if (item.dir !== '/dev/null') {
          router.mount(item.path, await fileServer(item.dir, item.options));
        }
        break;
      case 'proxy':
        router.mount(item.path, proxy(item.target, item.options));
        break;
      case 'fixture':
        const handler = (_: IncomingMessage, res: ServerResponse) => {
          for (const [key, value] of Object.entries(item.headers)) {
            res.setHeader(key, value);
          }
          res.statusCode = item.status;
          res.end(item.body);
        };
        if (item.method === 'GET') {
          router.onRequest('HEAD', item.path, handler);
        }
        router.onRequest(item.method, item.path, handler);
        break;
      case 'redirect':
        router.at(
          item.path,
          requestHandler((_, res) => {
            res.setHeader('location', item.target);
            res.statusCode = item.status;
            res.end();
          }),
        );
        break;
    }
  }
  return router;
}
