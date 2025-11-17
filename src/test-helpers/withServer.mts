import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { getAddressURL } from '../util/getAddressURL.mts';
import { BlockingQueue } from '../util/BlockingQueue.mts';
import { requestHandler, type Handler } from '../core/handler.mts';
import { addTeardown } from '../core/close.mts';
import {
  toListeners,
  type NativeListeners,
  type NativeListenersOptions,
} from '../core/toListeners.mts';

interface TestParams {
  server: Server;
  listeners: NativeListeners;
  expectError: (message?: string) => void;
}

export async function withServer(
  handler: Handler,
  test: (address: string, params: TestParams) => Promise<void>,
  options: Omit<NativeListenersOptions, 'onError'> = {},
) {
  const errors: string[] = [];
  const listeners = toListeners(handler, {
    ...options,
    onError: (err, action, req) => {
      let message = action;
      if (req?.url) {
        message += ` ${req.url}`;
      }
      message += ': ';
      if (err instanceof Error) {
        if ('code' in err) {
          message += `${err.code} `;
        }
        message += err.stack ?? String(err);
      } else {
        message += String(err);
      }
      errors.push(message);
    },
  });
  const server = createServer();
  server.addListener('clientError', listeners.clientError);
  server.addListener('request', listeners.request);
  server.addListener('checkContinue', listeners.request);
  server.addListener('checkExpectation', listeners.request);
  server.addListener('upgrade', listeners.upgrade);
  server.shouldUpgradeCallback = listeners.shouldUpgrade;
  await new Promise<void>((resolve) => server.listen(0, 'localhost', resolve));
  try {
    await test(getAddressURL(server.address()), {
      server,
      listeners,
      expectError: (message = '') => {
        const p = errors.findIndex((m) => m.includes(message));
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
  } catch (err) {
    if (errors.length > 0) {
      console.log('unexpected errors:\n%s', errors.join('\n'));
    }
    throw err;
  } finally {
    listeners.hardClose(() => server.closeAllConnections());
    await new Promise<void>((resolve, reject) => {
      const tm = setTimeout(() => {
        server.closeAllConnections();
        reject(new Error('timed out waiting for connections to close'));
      }, 1000);
      server.close((err) => {
        clearTimeout(tm);
        if (err) {
          reject(err);
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
  return withServer(handler, async (url, params) => {
    const ac = new AbortController();
    let handleError = fail;
    const request = fetch(url, { signal: ac.signal, ...requestInit }).catch((error) =>
      handleError(error),
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
          handleError = () => {};
        },
        abort: async () => {
          handleError = () => {};
          ac.abort();
          await request;
        },
        teardown,
      });
    } finally {
      await teardown();
    }
    await request;
  });
}
