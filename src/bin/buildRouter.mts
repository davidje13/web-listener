import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
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
  getAbsolutePath,
} from '../index.mts';
import type { ConfigMount } from './config/types.mts';
import { dependencies } from './modules/dependencies.mts';
import { Mapper, nginxTokenise } from './nginx.mts';
import { render } from './template.mts';
import { TransientError } from './TransientError.mts';

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
          path: getAbsolutePath(req),
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
          try {
            router.mount(item.path, await fileServer(item.dir, { ...item.options, negotiator }));
          } catch (error: unknown) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
              throw new TransientError(`directory to serve not found at ${item.dir}`);
            } else {
              throw error;
            }
          }
        }
        break;
      case 'proxy':
        router.mount(
          item.path,
          proxy(item.target, {
            ...item.options,
            responseHeaders: [(_req, _res, headers) => ({ ...headers, ...item.options.headers })],
          }),
        );
        break;
      case 'fixture': {
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
      }
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
      case 'redirect-map':
        const mapper = new Mapper(item.options.caseSensitive);
        if (typeof item.mapping === 'string') {
          let content: string;
          try {
            content = await readFile(item.mapping, 'utf-8');
          } catch (error: unknown) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
              throw new TransientError(`redirect-map file not found at ${item.mapping}`);
            } else {
              throw error;
            }
          }
          tokens: for (const statement of nginxTokenise(content)) {
            const key = statement[0]!;
            if (key.literal) {
              switch (key.token) {
                case 'default':
                  if (statement.length === 2) {
                    mapper.setDefault(statement[1]!.token);
                    continue tokens;
                  }
                  break;
                case 'hostnames':
                  throw new Error('redirect-map does not support hostnames');
                case 'include':
                  throw new Error('redirect-map does not support nested mapping files');
                case 'volatile':
                  // ignore
                  break;
              }
            }
            if (statement.length === 2) {
              mapper.add(key.token, statement[1]!.token);
            } else {
              throw new Error(
                `unknown statement in mapping file: ${statement.map((p) => JSON.stringify(p)).join(' ')}`,
              );
            }
          }
        } else {
          for (const [k, v] of Object.entries(item.mapping)) {
            mapper.add(k, v);
          }
        }
        router.use((req, res) => {
          const redirect = mapper.get(req.url ?? '/');
          if (redirect && redirect !== (req.url ?? '/')) {
            res.setHeader('location', redirect);
            res.statusCode = item.status;
            return res.end();
          }
          return CONTINUE;
        });
        break;
      case 'dependencies':
        router.mount(
          item.path,
          await dependencies(item.package, { ...item.options, modulesBasePath: item.path }),
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
