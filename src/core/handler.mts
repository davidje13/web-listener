import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { MaybePromise } from '../util/MaybePromise.mts';
import type { STOP, CONTINUE, NEXT_ROUTE, NEXT_ROUTER } from './RoutingInstruction.mts';

type ReturnHandlerParameter = object | null | undefined;

export type HandlerResult =
  | void
  | null
  | undefined
  | typeof STOP
  | typeof CONTINUE
  | typeof NEXT_ROUTE
  | typeof NEXT_ROUTER
  | ReturnHandlerParameter;

export type RequestHandlerFn<Req = {}> = (
  req: IncomingMessage & Req,
  res: ServerResponse,
) => MaybePromise<HandlerResult>;

export interface RequestHandler<Req = {}> {
  handleRequest: RequestHandlerFn<Req>;
}

export const requestHandler = <Req,>(
  handler: RequestHandler<Req> | RequestHandlerFn<Req>,
): RequestHandler<Req> => (typeof handler === 'function' ? { handleRequest: handler } : handler);

export type UpgradeHandlerFn<Req = {}> = (
  req: IncomingMessage & Req,
  socket: Duplex,
  head: Buffer,
) => MaybePromise<HandlerResult>;

export type ShouldUpgradeFn<Req = {}> = (req: IncomingMessage & Req) => boolean;

export interface UpgradeHandler<Req = {}> {
  handleUpgrade: UpgradeHandlerFn<Req>;
  shouldUpgrade?: ShouldUpgradeFn<Req> | undefined;
}

export const upgradeHandler = <Req,>(
  handler: UpgradeHandler<Req> | UpgradeHandlerFn<Req>,
  shouldUpgrade?: ShouldUpgradeFn<Req>,
): UpgradeHandler<Req> =>
  typeof handler === 'function'
    ? { handleUpgrade: handler, shouldUpgrade }
    : { shouldUpgrade, ...handler };

export const anyHandler = <Req,>(
  handler: UpgradeHandlerFn<Req> & RequestHandlerFn<Req>,
  shouldUpgrade: ShouldUpgradeFn<Req> = NO_UPGRADE,
): RequestHandler<Req> & UpgradeHandler<Req> => ({
  handleRequest: handler,
  handleUpgrade: handler,
  shouldUpgrade: shouldUpgrade,
});

export type ErrorOutput =
  | { response: ServerResponse; socket?: never; head?: never; hasUpgraded?: never }
  | { response?: never; socket: Duplex; head: Buffer; hasUpgraded: boolean };

export type ErrorHandlerFn<Req = {}> = (
  error: unknown,
  req: IncomingMessage & Req,
  output: ErrorOutput,
) => MaybePromise<HandlerResult>;

export interface ErrorHandler<Req = {}> {
  handleError: ErrorHandlerFn<Req>;
  shouldHandleError?: (error: unknown, req: IncomingMessage & Req, output: ErrorOutput) => boolean;
}

export const errorHandler = <Req,>(
  handler: ErrorHandler<Req> | ErrorHandlerFn<Req>,
): ErrorHandler<Req> => (typeof handler === 'function' ? { handleError: handler } : handler);

type TypedErrorHandlerFn<Error, Req = {}> = (
  error: Error,
  req: IncomingMessage & Req,
  response: ServerResponse,
) => MaybePromise<HandlerResult>;

export const typedErrorHandler = <Error, Req>(
  ErrorClass: abstract new (...args: any[]) => Error,
  handler: TypedErrorHandlerFn<Error, Req>,
) => conditionalErrorHandler((x): x is Error => x instanceof ErrorClass, handler);

type ConditionalErrorHandler = (<Error, Req>(
  test: (x: unknown) => x is Error,
  handler: TypedErrorHandlerFn<Error, Req>,
) => ErrorHandler<Req>) &
  (<Req>(
    test: (x: unknown) => boolean,
    handler: TypedErrorHandlerFn<unknown, Req>,
  ) => ErrorHandler<Req>);

export const conditionalErrorHandler: ConditionalErrorHandler = <Error, Req>(
  test: (x: unknown) => boolean,
  handler: TypedErrorHandlerFn<Error, Req>,
): ErrorHandler<Req> => ({
  handleError: (error, req, output) => {
    if (output.response && test(error)) {
      return handler(error as Error, req, output.response);
    }
    throw error;
  },
  shouldHandleError: (error, _, output) => Boolean(output.response) && test(error),
});

export type Handler<Req = {}> = Partial<
  RequestHandler<Req> & UpgradeHandler<Req> & ErrorHandler<Req>
>;

export type RequestReturnHandlerFn<Req = {}> = (
  value: ReturnHandlerParameter,
  req: IncomingMessage & Req,
  res: ServerResponse,
) => MaybePromise<void>;

export const wrapHandlerRequest = <Req,>(
  handler: Handler<Req> | RequestHandlerFn<Req>,
): Handler<Req> => (typeof handler === 'function' ? { handleRequest: handler } : handler);

export const wrapHandlerUpgrade = <Req,>(
  handler: Handler<Req> | UpgradeHandlerFn<Req>,
): Handler<Req> => (typeof handler === 'function' ? { handleUpgrade: handler } : handler);

const NO_UPGRADE = () => false;
