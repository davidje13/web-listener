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
import { render } from './template.mts';

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
              res.setHeader(key, render(value, getParam(req)));
            } else if (typeof value === 'number') {
              res.setHeader(key, value);
            } else {
              res.setHeader(
                key,
                value.map((v) => render(v, getParam(req))),
              );
            }
          }
          res.statusCode = item.status;
          res.end(render(item.body, getParam(req)));
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
            let redirect = render(item.target, getParam(req), 'uri');
            if (item.target[0] === '/') {
              // ensure location has exactly one leading /, else some clients may interpret it as a full URL
              redirect = redirect.replace(/^\/{2,}/, '/');
            }
            res.setHeader('location', redirect);
            res.statusCode = item.status;
            res.end();
          }),
        );
        break;
    }
  }
  return router;
}

const getParam = (req: IncomingMessage) => (key: string) =>
  key === '?'
    ? { _value: getSearch(req) || undefined, _encoding: 'uri' }
    : key[0] === '?'
      ? { _value: getQuery(req, key.substring(1)), _encoding: 'raw' }
      : { _value: getPathParameter(req, key), _encoding: 'raw' };
