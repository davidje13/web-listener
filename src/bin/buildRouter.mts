import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  addTeardown,
  CONTINUE,
  fileServer,
  getPathParameter,
  getQuery,
  getSearch,
  Negotiator,
  proxy,
  requestHandler,
  Router,
} from '../index.mts';
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
          const negotiator =
            item.options.negotiation && item.options.negotiation.length > 0
              ? new Negotiator(item.options.negotiation)
              : undefined;
          router.mount(item.path, await fileServer(item.dir, { ...item.options, negotiator }));
        }
        break;
      case 'proxy':
        router.mount(item.path, proxy(item.target, item.options));
        break;
      case 'fixture':
        const handler = (req: IncomingMessage, res: ServerResponse) => {
          for (const [key, value] of Object.entries(item.headers)) {
            if (typeof value === 'string') {
              res.setHeader(key, populate(req, value));
            } else if (typeof value === 'number') {
              res.setHeader(key, value);
            } else {
              res.setHeader(
                key,
                value.map((v) => populate(req, v)),
              );
            }
          }
          res.statusCode = item.status;
          res.end(populate(req, item.body));
        };
        if (item.method === 'GET') {
          router.onRequest('HEAD', item.path, handler);
        }
        router.onRequest(item.method, item.path, handler);
        break;
      case 'redirect':
        router.at(
          item.path,
          requestHandler((req, res) => {
            res.setHeader('location', populate(req, item.target));
            res.statusCode = item.status;
            res.end();
          }),
        );
        break;
    }
  }
  return router;
}

function populate(req: IncomingMessage, template: string): string {
  return template.replaceAll(
    /\$\{([^${}:]+)(?::-(([^}\\]|\\.)*))?\}/g,
    (_, key: string, def?: string) => {
      let p: unknown;
      if (key === '?') {
        p = getSearch(req);
      } else if (key[0] === '?') {
        p = getQuery(req, key.substring(1));
      } else {
        p = getPathParameter(req, key);
      }
      if (typeof p === 'string') {
        return p;
      } else if (Array.isArray(p)) {
        return p.join('/');
      } else {
        return def ?? '';
      }
    },
  );
}
