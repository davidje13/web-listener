import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as httpsCreateServer } from 'node:https';
import { getAddressURL } from '../util/getAddressURL.mts';
import { BlockingQueue } from '../util/BlockingQueue.mts';
import { requestHandler, type Handler } from '../core/handler.mts';
import { addTeardown } from '../core/close.mts';
import {
  toListeners,
  type NativeListeners,
  type NativeListenersOptions,
} from '../core/toListeners.mts';
import { generateTLSConfig } from './generateTLSConfig.mts';

interface TestParams {
  server: Server;
  listeners: NativeListeners;
  expectError: (message?: string | RegExp) => void;
}

type TestServerOptions = Omit<NativeListenersOptions, 'onError'> & { tls?: boolean };

export async function withServer(
  handler: Handler,
  test: (address: string, params: TestParams) => Promise<void>,
  { tls, ...options }: TestServerOptions = {},
) {
  const errors: string[] = [];
  const listeners = toListeners(handler, {
    ...options,
    onError: (error, context, req) => {
      let message = context;
      if (req?.url) {
        message += ` ${req.url}`;
      }
      message += ': ';
      if (error instanceof Error) {
        if ('code' in error) {
          message += `${error.code} `;
        }
        message += error.stack ?? String(error);
      } else {
        message += String(error);
      }
      errors.push(message);
    },
  });
  const server = tls ? httpsCreateServer(await generateTLSConfig()) : createServer();
  server.addListener('clientError', listeners.clientError);
  server.addListener('request', listeners.request);
  server.addListener('checkContinue', listeners.request);
  server.addListener('checkExpectation', listeners.request);
  server.addListener('upgrade', listeners.upgrade);
  server.shouldUpgradeCallback = listeners.shouldUpgrade;
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  try {
    await test(getAddressURL(server.address(), tls ? 'https' : 'http'), {
      server,
      listeners,
      expectError: (message: string | RegExp = '') => {
        const p = errors.findIndex((m) =>
          message instanceof RegExp ? message.test(m) : m.includes(message),
        );
        if (p === -1) {
          throw new Error(
            `error not found: ${JSON.stringify(message)}\nseen:\n${errors.join('\n')}`,
          );
        }
        errors.splice(p, 1);
      },
    });
    const deadline = Date.now() + 200; // give connections a moment to complete the FIN/ACK dance
    while (true) {
      const remaining = listeners.countConnections();
      if (!remaining) {
        break;
      }
      if (Date.now() >= deadline) {
        throw new Error(`open connections remaining after test: ${remaining}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    if (errors.length > 0) {
      const error = new Error('unexpected errors:\n' + errors.join('\n'));
      errors.length = 0;
      throw error;
    }
  } catch (error) {
    if (errors.length > 0) {
      console.log('unexpected errors:\n%s', errors.join('\n'));
    }
    throw error;
  } finally {
    listeners.hardClose(() => server.closeAllConnections());
    await new Promise<void>((resolve, reject) => {
      const tm = setTimeout(() => {
        server.closeAllConnections();
        reject(new Error('timed out waiting for connections to close'));
      }, 1000);
      server.close((error) => {
        clearTimeout(tm);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

export async function inRequestHandler(
  test: (
    req: IncomingMessage,
    res: ServerResponse,
    params: TestParams & {
      expectFetchError: () => void;
      abort: () => Promise<void>;
      teardown: () => Promise<void>;
    },
  ) => Promise<void>,
  requestInit: RequestInit = {},
  options: TestServerOptions = {},
) {
  const captured = new BlockingQueue<{ req: IncomingMessage; res: ServerResponse }>();
  const hold = new BlockingQueue();
  const handler = requestHandler(async (req, res) => {
    captured.push({ req, res });
    await hold.shift();
    if (!res.closed) {
      res.end();
    }
  });
  return withServer(
    handler,
    async (url, params) => {
      const ac = new AbortController();
      let resolveRequest!: () => void;
      let rejectRequest!: (err: Error) => void;
      const requestPromise = new Promise<void>((resolve, reject) => {
        resolveRequest = resolve;
        rejectRequest = reject;
      });
      await Promise.all([
        requestPromise,
        (async () => {
          if (options.tls) {
            process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
          }
          const request = fetch(url, { signal: ac.signal, ...requestInit }).then(
            resolveRequest,
            (err) => rejectRequest(new Error(`failed to fetch ${url}`, { cause: err })),
          );
          const { req, res } = await captured.shift();
          const teardownSignal = new Promise<void>((resolve) => addTeardown(req, resolve));
          const teardown = () => {
            hold.push('done');
            return teardownSignal;
          };
          try {
            await test(req, res, {
              ...params,
              expectFetchError: () => {
                rejectRequest = () => {};
                resolveRequest();
              },
              abort: async () => {
                rejectRequest = () => {};
                resolveRequest();
                ac.abort();
                await request;
              },
              teardown,
            });
          } finally {
            await teardown();
          }
        })(),
      ]).finally(() => {
        if (options.tls) {
          delete process.env['NODE_TLS_REJECT_UNAUTHORIZED'];
        }
      });
    },
    options,
  );
}
