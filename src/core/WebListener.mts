import { createServer, type IncomingMessage, type Server, type ServerOptions } from 'node:http';
import type { TypedEventTarget } from '../polyfill/TypedEventTarget.mts';
import { toListeners, type NativeListenersOptions } from './toListeners.mts';
import type { WithoutPathParameters } from './pathParameters.mts';
import type { Handler } from './handler.mts';
import { internalLogError } from './errorHandler.mts';

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
  /** @internal */ private readonly _handler: Handler;

  constructor(handler: Handler<WithoutPathParameters>) {
    super();
    this._handler = handler;
  }

  attach(server: Server, options: ListenerOptions = {}) {
    const listeners = toListeners(this._handler, {
      ...options,
      onError: this._dispatchError.bind(this, server),
    });
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

    let closing = false;
    const detach = (reason = '', existingConnectionTimeout = -1, forceCloseAll = false) => {
      if (!closing) {
        closing = true;
        server.removeListener('checkContinue', listeners.request);
        server.removeListener('checkExpectation', listeners.request);
        server.removeListener('request', listeners.request);
        server.removeListener('upgrade', listeners.upgrade);
        if (server.shouldUpgradeCallback === listeners.shouldUpgrade) {
          server.shouldUpgradeCallback = originalShouldUpgrade;
        }
        server.removeListener('clientError', listeners.clientError);
      }
      const closePending = () => {
        if (forceCloseAll) {
          // idle connections are purged automatically by server.close, and in theory we
          // have sent a hard close message to all the other connections, but in practice
          // Node.js considers NEW connections which have not yet sent a request to not be
          // "idle", so they can hang the server unless we kill them:
          server.closeAllConnections();
        }
      };
      if (existingConnectionTimeout > 0) {
        const hardCloseTm = setTimeout(listeners.hardClose, existingConnectionTimeout);
        listeners.softClose(reason, this._dispatchError.bind(this, server), () => {
          clearTimeout(hardCloseTm);
          closePending();
        });
      } else if (existingConnectionTimeout === 0) {
        listeners.hardClose(closePending);
      }
      // return the detached listeners in case the user wants to use their
      // own close() logic or check the number of active connections
      return listeners;
    };

    return detach;
  }

  listen(
    port: number,
    host: string,
    options: CombinedServerOptions = {},
  ): Promise<AugmentedServer> {
    if (options.shouldUpgradeCallback) {
      options = { overrideShouldUpgradeCallback: false, ...options };
    }
    const s = createServer(options);
    if (options.socketTimeout) {
      s.setTimeout(options.socketTimeout);
    }
    const detach = this.attach(s, options);
    const augmented = Object.assign(s, {
      closeWithTimeout: (reason: string, timeout: number) =>
        new Promise<void>((resolve) => {
          s.close(() => resolve()); // ignore any error (happens if server is already closed)
          detach(reason, timeout, true);
        }),
    });
    return new Promise((resolve, reject) => {
      s.once('error', reject);
      s.listen(port, host, options.backlog ?? 511, () => {
        s.off('error', reject);
        resolve(augmented);
      });
    });
  }

  /** @internal */
  private _dispatchError(
    server: Server,
    error: unknown,
    action: string,
    request?: IncomingMessage,
  ) {
    const detail = { error, server, action, request };
    if (this.dispatchEvent(new CustomEvent<RequestErrorDetail>('error', { detail }))) {
      internalLogError(error, action, request);
    }
  }
}

export interface RequestErrorDetail {
  error: unknown;
  server: Server;
  action: string;
  request: IncomingMessage | undefined;
}

export interface AugmentedServer extends Server {
  closeWithTimeout(reason: string, timeout: number): Promise<void>;
}
