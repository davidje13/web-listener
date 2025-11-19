import type { IncomingMessage } from 'node:http';
import { ErrorAccumulator } from '../util/ErrorAccumulator.mts';
import {
  internalCompilePathPattern,
  type NamedPathParameter,
  type ParametersFromPath,
} from './path.mts';
import {
  CONTINUE,
  NEXT_ROUTE,
  NEXT_ROUTER,
  RoutingInstruction,
  STOP,
} from './RoutingInstruction.mts';
import { internalMustGetProps, internalRunDeferred, type MessageProps } from './messages.mts';
import { internalBeginPathScope, type WithPathParameters } from './pathParameters.mts';
import {
  errorHandler,
  wrapHandlerUpgrade,
  wrapHandlerRequest,
  type HandlerResult,
  type RequestHandlerFn,
  type RequestHandler,
  type UpgradeHandlerFn,
  type UpgradeHandler,
  type ErrorHandlerFn,
  type ErrorHandler,
  type Handler,
  type RequestReturnHandlerFn,
  type ErrorOutput,
} from './handler.mts';

export type CommonMethod =
  | 'DELETE'
  | 'GET'
  | 'HEAD'
  | 'OPTIONS'
  | 'PATCH'
  | 'POST'
  | 'PUT'
  | 'TRACE';

export type CommonUpgrade = 'http/2' | 'http/3' | 'https' | 'h2c' | 'websocket';

type RelaxedRequestHandler<Req = {}> =
  | RequestHandlerFn<Req>
  | RequestHandler<Req>
  | ErrorHandler<Req>;

type RelaxedRequestHandlerOrExplicitUpgrade<Req = {}> =
  | RelaxedRequestHandler<Req>
  | UpgradeHandler<Req>;

type RelaxedUpgradeHandler<Req = {}> =
  | UpgradeHandlerFn<Req>
  | UpgradeHandler<Req>
  | ErrorHandler<Req>;

type MethodWrapper<Req, This> = <Path extends string>(
  path: Path,
  ...handlers: RelaxedRequestHandler<Req & WithPathParameters<ParametersFromPath<Path>>>[]
) => This;

type UpgradeWrapper<Req, This> = <Path extends string>(
  path: Path,
  ...handlers: RelaxedUpgradeHandler<Req & WithPathParameters<ParametersFromPath<Path>>>[]
) => This;

const HTTP_PROTOCOL = Symbol('http');

interface RegisteredRoute {
  _methods: Set<string> | string | null;
  _protocol: string | typeof HTTP_PROTOCOL | null;
  _pathPattern: null | RegExp;
  _namedParameters: NamedPathParameter[];
  _handlerChain: Handler<unknown>[];
}

export class Router<Req = {}> implements Handler<Req> {
  /** @internal */ declare private readonly _routes: RegisteredRoute[];
  /** @internal */ declare private readonly _returnHandlers: RequestReturnHandlerFn<unknown>[];

  constructor() {
    this._routes = [];
    this._returnHandlers = [];
  }

  /** @internal */
  private _add<R extends Req>(
    methods: Set<string> | string | null,
    protocol: string | typeof HTTP_PROTOCOL | null,
    path: string | null,
    allowSubRoutes: boolean,
    handlers: Handler<R>[],
  ) {
    const compiled = path
      ? internalCompilePathPattern(path, allowSubRoutes)
      : { _pattern: null, _parameters: [] };
    this._routes.push({
      _methods: methods,
      _protocol: typeof protocol === 'string' ? protocol.toLowerCase() : protocol,
      _pathPattern: compiled._pattern,
      _namedParameters: compiled._parameters,
      _handlerChain: handlers as Handler<unknown>[],
    });
    return this;
  }

  /**
   * Register handlers or routers for all requests, upgrades, and errors, on all methods and paths.
   */
  use(...handlers: RelaxedRequestHandlerOrExplicitUpgrade<Req>[]): this {
    return this._add(null, null, null, true, handlers.map(wrapHandlerRequest));
  }

  /**
   * Register handlers or routers for all requests, upgrades, and errors, on all methods for all
   * paths within the given path root.
   *
   * To register handlers at the path but not subpaths, use `.at` instead.
   */
  mount<Path extends string>(
    path: Path,
    ...handlers: RelaxedRequestHandlerOrExplicitUpgrade<
      Req & WithPathParameters<ParametersFromPath<Path>>
    >[]
  ): this {
    return this._add(null, null, path, true, handlers.map(wrapHandlerRequest));
  }

  /**
   * Create a new router mounted at the path, and call the given function to configure it.
   */
  within<Path extends string>(
    path: Path,
    init: (subRouter: Router<Req & WithPathParameters<ParametersFromPath<Path>>>) => void,
  ): this {
    const subRouter = new Router<Req & WithPathParameters<ParametersFromPath<Path>>>();
    init(subRouter);
    return this.mount(path, subRouter);
  }

  /**
   * Register handlers or routers for all requests, upgrades, and errors, on all methods for a
   * specific path.
   *
   * To register handlers at the path and all subpaths, use `.mount` instead.
   */
  at<Path extends string>(
    path: Path,
    ...handlers: RelaxedRequestHandlerOrExplicitUpgrade<
      Req & WithPathParameters<ParametersFromPath<Path>>
    >[]
  ): this {
    return this._add(null, null, path, false, handlers.map(wrapHandlerRequest));
  }

  /**
   * Register handlers for requests or errors (not upgrades) on a specific method for a specific
   * path.
   */
  onRequest<Path extends string, Method extends string = CommonMethod>(
    method: Method | Iterable<Method>,
    path: Path,
    ...handlers: RelaxedRequestHandler<Req & WithPathParameters<ParametersFromPath<Path>>>[]
  ): this {
    return this._add(
      wrapMethods(method),
      HTTP_PROTOCOL,
      path,
      false,
      handlers.map(wrapHandlerRequest),
    );
  }

  /**
   * Register handlers for upgrades or errors (not requests) on a specific method and protocol
   * for a specific path.
   */
  onUpgrade<
    Path extends string,
    Method extends string = CommonMethod,
    Protocol extends string = CommonUpgrade,
  >(
    method: Method | Iterable<Method> | null,
    protocol: Protocol,
    path: Path,
    ...handlers: RelaxedUpgradeHandler<Req & WithPathParameters<ParametersFromPath<Path>>>[]
  ) {
    return this._add(wrapMethods(method), protocol, path, false, handlers.map(wrapHandlerUpgrade));
  }

  /**
   * Register error handlers.
   *
   * Error handlers are called if a request or upgrade handler which is before them in the chain
   * throws. Error handlers can send a response and return to complete processing of the request.
   * Error handlers can also return `CONTINUE` (or any other routing instruction) to pass control
   * back to request or upgrade handlers. If an error handler throws, a combined error
   * (`SuppressedError`) will be sent to the next error handler.
   */
  onError(...handlers: (ErrorHandler<Req> | ErrorHandlerFn<Req>)[]): this {
    return this._add(null, null, null, true, handlers.map(errorHandler));
  }

  /**
   * Register return handlers.
   *
   * Return handlers are called if a request or error handler returns a value which is not a
   * routing instruction. They can be used for features like templating or ensuring connections
   * are always closed when a handler returns.
   *
   * Return hanlders are called in the order they were registered, and from the innermost router
   * to the outermost rooter. Return handlers are not called for upgrade requests.
   *
   * Return handlers are not ordered with the other handlers, so they can be registered upfront if
   * desired. If a return handler throws, the error will be passed to the next error handler after
   * the request handler which triggered it.
   */
  onReturn(...handlers: RequestReturnHandlerFn<Req>[]): this {
    this._returnHandlers.push(...(handlers as RequestReturnHandlerFn<unknown>[]));
    return this;
  }

  /**
   * Convenience wrapper for `.onRequest`, accepting paths with a HTTP verb at the start (separated
   * by a space).
   */
  on<Path extends string>(
    path: `${CommonMethod} ${Path}`,
    ...handlers: RelaxedRequestHandler<Req & WithPathParameters<ParametersFromPath<Path>>>[]
  ): this {
    const parts = /^([A-Z]+) (\/.*)$/.exec(path);
    if (!parts) {
      throw new TypeError('invalid method + path spec: ' + JSON.stringify(path));
    }
    return this._add(parts[1]!, HTTP_PROTOCOL, parts[2]!, false, handlers.map(wrapHandlerRequest));
  }

  /**
   * Registers handlers for GET requests at the given path. Note that these handlers will also
   * be used for HEAD requests by default. To use different HEAD handling, you can register an
   * explicit HEAD handler earlier in the router, or you can use `.getOnly` instead of `.get`.
   *
   * @param path
   * @param handlers
   * @returns
   */
  get: MethodWrapper<Req, this> = (path, ...handlers) => {
    return this._add(
      HEAD_GET_METHODS,
      HTTP_PROTOCOL,
      path,
      false,
      handlers.map(wrapHandlerRequest),
    );
  };

  /** Alias for `onRequest('DELETE', path, ...handlers)` */
  delete: MethodWrapper<Req, this> = (...args) => this.onRequest('DELETE', ...args);
  /**
   * Alias for `onRequest('GET', path, ...handlers)`
   *
   * Unlike `.get`, this will _not_ also use the handler for HEAD requests.
   */
  getOnly: MethodWrapper<Req, this> = (...args) => this.onRequest('GET', ...args);
  /** Alias for `onRequest('HEAD', path, ...handlers)` */
  head: MethodWrapper<Req, this> = (...args) => this.onRequest('HEAD', ...args);
  /** Alias for `onRequest('OPTIONS', path, ...handlers)` */
  options: MethodWrapper<Req, this> = (...args) => this.onRequest('OPTIONS', ...args);
  /** Alias for `onRequest('PATCH', path, ...handlers)` */
  patch: MethodWrapper<Req, this> = (...args) => this.onRequest('PATCH', ...args);
  /** Alias for `onRequest('POST', path, ...handlers)` */
  post: MethodWrapper<Req, this> = (...args) => this.onRequest('POST', ...args);
  /** Alias for `onRequest('PUT', path, ...handlers)` */
  put: MethodWrapper<Req, this> = (...args) => this.onRequest('PUT', ...args);

  /** Alias for `onUpgrade('GET', 'websocket', path, ...handlers)` */
  ws: UpgradeWrapper<Req, this> = (...args) => this.onUpgrade('GET', 'websocket', ...args);

  /**
   * Run routing on a request.
   * The request must already be registered (i.e. have come through a WebListener).
   *
   * This can be used for complex custom sub-routing, but is otherwise not useful.
   *
   * To register an upgrade handler, use `.onRequest` or a convenience method.
   */
  async handleRequest(req: IncomingMessage & Req): Promise<HandlerResult> {
    // this method is provided for interface conformance, but sub-routers are
    // actually invoked directly via the internal _handleRaw as an optimisation
    return this._handle(req, new ErrorAccumulator());
  }

  /**
   * Run routing on an upgrade request.
   * The request must already be registered (i.e. have come through a WebListener).
   *
   * This can be used for complex custom sub-routing, but is otherwise not useful.
   *
   * To register an upgrade handler, use `.onUpgrade` or a convenience method.
   */
  async handleUpgrade(req: IncomingMessage & Req): Promise<HandlerResult> {
    // this method is provided for interface conformance, but sub-routers are
    // actually invoked directly via the internal _handleRaw as an optimisation
    return this._handle(req, new ErrorAccumulator());
  }

  /**
   * Run routing on an error.
   * The request must already be registered (i.e. have come through a WebListener).
   *
   * This can be used for complex custom sub-routing, but is otherwise not useful.
   *
   * To register an error handler, use `.onError`.
   */
  async handleError(error: unknown, req: IncomingMessage & Req): Promise<HandlerResult> {
    // this method is provided for interface conformance, but sub-routers are
    // actually invoked directly via the internal _handleRaw as an optimisation
    const currentError = new ErrorAccumulator();
    currentError._add(error);
    return this._handle(req, currentError);
  }

  shouldUpgrade(req: IncomingMessage & Req) {
    return this._shouldUpgradeRaw(internalMustGetProps(req));
  }

  /** @internal */
  _shouldUpgradeRaw(props: MessageProps) {
    for (const route of this._routes) {
      const match = internalCheckMatch(props, route);
      if (!match) {
        continue;
      }

      let teardownScope = () => {};
      if (match !== true) {
        try {
          teardownScope = internalBeginPathScope(props, match._remainingURL, []);
        } catch {
          continue;
        }
      }
      try {
        for (const handler of route._handlerChain) {
          if (internalCheckShouldUpgrade(handler, props)) {
            return true;
          }
        }
      } finally {
        teardownScope();
      }
    }
    return false;
  }

  /** @internal */
  private async _handle(
    req: IncomingMessage,
    currentError: ErrorAccumulator,
  ): Promise<HandlerResult> {
    const props = internalMustGetProps(req);
    const r = await this._handleRaw(props, currentError);
    if (currentError._hasError) {
      throw currentError._error;
    }
    return r;
  }

  /** @internal */
  async _handleRaw(props: MessageProps, currentError: ErrorAccumulator): Promise<HandlerResult> {
    for (const route of this._routes) {
      const match = internalCheckMatch(props, route);
      if (!match) {
        continue;
      }

      let teardownScope = () => {};
      if (match !== true) {
        try {
          const pathParameters = match._getPathParameters();
          teardownScope = internalBeginPathScope(props, match._remainingURL, pathParameters);
        } catch (error: unknown) {
          // e.g. malformed URI
          currentError._add(error);
          continue;
        }
      }
      try {
        const result = await internalRunHandlerChain(
          props,
          route._handlerChain,
          this._returnHandlers,
          currentError,
        );
        if (result === NEXT_ROUTER) {
          break;
        } else if (result === NEXT_ROUTE) {
          continue;
        } else {
          return result;
        }
      } finally {
        teardownScope();
      }
    }
    return CONTINUE;
  }
}

const HEAD_GET_METHODS = new Set(['HEAD', 'GET']);

const wrapMethods = (methods: string | Iterable<string> | null) =>
  !methods ? null : typeof methods === 'string' ? methods : new Set(methods);

function internalCheckMatch(props: MessageProps, route: RegisteredRoute) {
  if (typeof route._methods === 'string') {
    if (route._methods !== props._request.method) {
      return false;
    }
  } else if (route._methods !== null && !route._methods.has(props._request.method ?? '')) {
    return false;
  }

  if (route._protocol === HTTP_PROTOCOL) {
    if (props._upgradeProtocols) {
      return false;
    }
  } else if (route._protocol !== null) {
    if (!props._upgradeProtocols?.has(route._protocol)) {
      return false;
    }
  }

  if (route._pathPattern === null) {
    return true;
  }

  const matched = route._pathPattern.exec(props._decodedPathname);
  if (!matched) {
    return false;
  }
  return {
    _remainingURL: '/' + (matched.groups?.['rest'] ?? ''),
    _getPathParameters: () =>
      route._namedParameters.map((parameter, index): [string, unknown] => [
        parameter._name,
        parameter._reader(matched[index + 1]),
      ]),
  };
}

async function internalRunHandlerChain(
  props: MessageProps,
  chain: Handler<unknown>[],
  returnHandlers: RequestReturnHandlerFn<unknown>[],
  currentError: ErrorAccumulator,
): Promise<HandlerResult> {
  for (const handler of chain) {
    let result = await internalRunHandler(handler, props, currentError);
    if (result === CONTINUE) {
      continue;
    }
    if (
      !props._upgradeProtocols &&
      !(result instanceof RoutingInstruction) &&
      returnHandlers.length
    ) {
      try {
        const parameter = typeof result === 'object' ? result : undefined;
        const req = props._request;
        const res = props._output!._target;
        for (const returnHandler of returnHandlers) {
          await returnHandler(parameter, req, res);
        }
      } catch (error: unknown) {
        currentError._add(error);
        continue;
      }
    }

    return result;
  }
  return NEXT_ROUTE;
}

export async function internalRunHandler(
  handler: Handler,
  props: MessageProps,
  currentError: ErrorAccumulator,
): Promise<HandlerResult> {
  if (handler instanceof Router) {
    // invoke routers directly (for improved performance and error reporting)
    return handler._handleRaw(props, currentError);
  }
  let result: HandlerResult = CONTINUE;
  try {
    if (currentError._hasError) {
      if (handler.handleError) {
        const error = currentError._error;
        const output: ErrorOutput = props._upgradeProtocols
          ? {
              socket: props._output!._target,
              head: props._output!._head,
              hasUpgraded: props._hasUpgraded ?? false,
            }
          : { response: props._output!._target };
        if (
          !handler.shouldHandleError ||
          handler.shouldHandleError(error, props._request, output)
        ) {
          currentError._clear(); // clear before calling handler in case handler throws a routing instruction
          result = await handler.handleError(error, props._request, output);
        }
      }
    } else if (props._upgradeProtocols) {
      if (handler.handleUpgrade) {
        const out = props._output!;
        result = await handler.handleUpgrade(props._request, out._target, out._head);
      }
    } else if (handler.handleRequest) {
      result = await handler.handleRequest(props._request, props._output!._target);
    }
  } catch (error: unknown) {
    if (error instanceof RoutingInstruction) {
      result = error;
    } else {
      currentError._add(error);
    }
  } finally {
    if (props._deferred.length) {
      await internalRunDeferred(props, currentError);
    }
  }
  return result === STOP ? undefined : result;
}

export function internalCheckShouldUpgrade(handler: Handler, props: MessageProps) {
  if (handler instanceof Router) {
    return handler._shouldUpgradeRaw(props);
  } else if (handler.shouldUpgrade) {
    try {
      return handler.shouldUpgrade(props._request);
    } catch (error: unknown) {
      props._errorCallback(error, 'checking should upgrade', props._request);
      return false;
    }
  } else {
    return Boolean(handler.handleUpgrade);
  }
}
