import { createServer, type IncomingMessage, type Server, type ServerOptions } from 'node:http';
import { guardTimeout } from '../util/guardTimeout.mts';
import type { TypedEventTarget } from '../polyfill/TypedEventTarget.mts';
import { internalLogError, toListeners, type NativeListenersOptions } from './toListeners.mts';
import type { Handler } from './handler.mts';

export interface ListenOptions {
  /**
   * `backlog` parameter sent to `server.listen`.
   *
   * @default 511
   */
  backlog?: number | undefined;

  /**
   * If given, this is passed to `server.timeout`. The number of milliseconds of inactivity before a socket is presumed to have timed out.
   */
  socketTimeout?: number | undefined;
}

export interface ListenerOptions extends Omit<NativeListenersOptions, 'onError'> {
  /**
   * Automatically send `417 Expectation Failed` for any request with a non-standard `Expect` header.
   * Set to `false` to allow application-specific use of this header.
   *
   * @default true (matching Node.js behaviour)
   */
  rejectNonStandardExpect?: boolean | undefined;

  /**
   * Automatically send `100 Continue` for any request with `Expect: 100-continue`.
   * If set to `false`, all handlers MUST call `acceptBody(req)` before attempting
   * to read the body of the request (bundled body parsing middleware does this
   * automatically).
   *
   * @default true (matching Node.js behaviour)
   */
  autoContinue?: boolean | undefined;

  /**
   * Override the shouldUpgradeCallback of the server with one that attempts to detect whether an
   * upgrade request would be handled by the current routes. The detection does not invoke any
   * handlers, but checks their `shouldUpgrade` function if it is present.
   *
   * @default true
   */
  overrideShouldUpgradeCallback?: boolean | undefined;
}

export type CombinedServerOptions = ServerOptions & ListenOptions & ListenerOptions;

export class WebListener extends (EventTarget as TypedEventTarget<
  WebListener,
  { error: CustomEvent<RequestErrorDetail> }
>) {
  /** @internal */ declare private readonly _handler: Handler;

  constructor(handler: Handler) {
    super();
    this._handler = handler;
  }

  attach(server: Server, options: ListenerOptions = {}) {
    const onError = (error: unknown, context: string, request: IncomingMessage | undefined) => {
      const detail = { server, error, context, request };
      if (
        this.dispatchEvent(
          new CustomEvent<RequestErrorDetail>('error', { detail, cancelable: true }),
        )
      ) {
        internalLogError(error, context, request);
      }
    };
    const listeners = toListeners(this._handler, { ...options, onError });
    if (options.autoContinue === false) {
      server.addListener('checkContinue', listeners.request);
    }
    if (options.rejectNonStandardExpect === false) {
      server.addListener('checkExpectation', listeners.request);
    }
    server.addListener('request', listeners.request);
    server.addListener('upgrade', listeners.upgrade);
    const originalShouldUpgrade = server.shouldUpgradeCallback ?? (() => false);
    if (options.overrideShouldUpgradeCallback !== false) {
      server.shouldUpgradeCallback = listeners.shouldUpgrade;
    }
    server.addListener('clientError', listeners.clientError);

    let removeListeners: (() => void) | undefined = () => {
      removeListeners = undefined;
      server.removeListener('checkContinue', listeners.request);
      server.removeListener('checkExpectation', listeners.request);
      server.removeListener('request', listeners.request);
      server.removeListener('upgrade', listeners.upgrade);
      if (server.shouldUpgradeCallback === listeners.shouldUpgrade) {
        server.shouldUpgradeCallback = originalShouldUpgrade;
      }
      server.removeListener('clientError', listeners.clientError);
    };

    return (
      reason = '',
      existingConnectionTimeout = -1,
      forShutdown = false,
      callback?: () => void,
    ) => {
      guardTimeout(existingConnectionTimeout, 'existingConnectionTimeout', true);
      if (!forShutdown) {
        removeListeners?.();
      }
      if (existingConnectionTimeout > 0) {
        const hardCloseTm = setTimeout(() => {
          removeListeners?.();
          // do not run callback - the softclose callback will still be invoked
          listeners.hardClose();
        }, existingConnectionTimeout);
        listeners.softClose(reason, onError, () => {
          removeListeners?.();
          clearTimeout(hardCloseTm);
          callback?.();
        });
      } else if (existingConnectionTimeout === 0) {
        removeListeners?.();
        listeners.hardClose(callback);
      } else {
        removeListeners?.();
        if (callback) {
          setImmediate(callback);
        }
      }
      // return the detached listeners in case the user wants to use their
      // own close() logic or check the number of active connections
      return listeners;
    };
  }

  createServer(options: ServerOptions & ListenerOptions = {}): AugmentedServer {
    if (options.shouldUpgradeCallback) {
      options = { overrideShouldUpgradeCallback: false, ...options };
    }
    const s = createServer(options);
    const detach = this.attach(s, options);
    const augmented = Object.assign(s, {
      closeWithTimeout: (reason: string, timeout: number) =>
        new Promise<void>((resolve) =>
          detach(reason, timeout, true, () => {
            s.close(() => resolve());
            s.closeAllConnections();
          }),
        ),
    });
    return augmented;
  }

  listen(
    port: number,
    host: string,
    options: CombinedServerOptions = {},
  ): Promise<AugmentedServer> {
    const s = this.createServer(options);
    if (options.socketTimeout) {
      s.setTimeout(options.socketTimeout);
    }
    return new Promise((resolve, reject) => {
      s.once('error', reject);
      s.listen(port, host, options.backlog ?? 511, () => {
        s.off('error', reject);
        resolve(s);
      });
    });
  }
}

export interface RequestErrorDetail {
  server: Server;
  error: unknown;
  context: string;
  request: IncomingMessage | undefined;
}

export interface AugmentedServer extends Server {
  closeWithTimeout(reason: string, timeout: number): Promise<void>;
}
