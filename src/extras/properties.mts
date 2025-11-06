import type { IncomingMessage } from 'node:http';
import { anyHandler, type RequestHandler, type UpgradeHandler } from '../core/handler.mts';
import { internalGetProps, internalMustGetProps } from '../core/messages.mts';
import { CONTINUE } from '../core/RoutingInstruction.mts';

export const internalAsFactory = <Args extends any[], T>(
  value: T | ((...args: Args) => T),
): ((...args: Args) => T) =>
  typeof value === 'function' ? (value as (...args: Args) => T) : () => value;

interface PropertiesMessageProps {
  _customProperties: Map<Property<unknown>, unknown>;
}

export interface Property<T> {
  factory: (req: IncomingMessage) => T;
  set(req: IncomingMessage, value: T): void;
  get(req: IncomingMessage): T;
  clear(req: IncomingMessage): void;
  withValue(value: T): RequestHandler & UpgradeHandler;
}

export function makeProperty<T>(
  defaultValue: T | ((req: IncomingMessage) => T) = throwNotSet,
): Property<T> {
  return {
    factory: internalAsFactory(defaultValue),
    set(req, value) {
      setProperty(req, this, value);
    },
    get(req) {
      return getProperty(req, this);
    },
    clear(req) {
      clearProperty(req, this);
    },
    withValue(value) {
      return anyHandler((req: IncomingMessage) => {
        setProperty(req, this, value);
        return CONTINUE;
      });
    },
  };
}

export const makeMemo = <T, Args extends any[] = []>(
  fn: (req: IncomingMessage, ...args: Args) => T,
  ...args: Args
): ((req: IncomingMessage) => T) => {
  const prop = { factory: (req) => fn(req, ...args) } as Property<T>;
  return (req) => getProperty(req, prop);
};

function getCustomProperties(props: Partial<PropertiesMessageProps>) {
  if (!props._customProperties) {
    props._customProperties = new Map();
  }
  return props._customProperties;
}

export function setProperty<T>(req: IncomingMessage, property: Property<T>, value: T) {
  const props = internalMustGetProps<PropertiesMessageProps>(req);
  getCustomProperties(props).set(property, value);
}

export function getProperty<T>(req: IncomingMessage, property: Property<T>): T {
  const props = internalGetProps<PropertiesMessageProps>(req);
  if (!props) {
    return property.factory(req);
  }
  const properties = getCustomProperties(props);
  if (properties.has(property)) {
    return properties.get(property) as T;
  }
  const v = property.factory(req);
  // note: if v is a Promise, we store it the same as any other value
  // this means that all future requests will return the promise, which may
  // already be resolved (so the value will be available in the next tick)
  properties.set(property, v);
  return v;
}

export function clearProperty<T>(req: IncomingMessage, property: Property<T>): void {
  const props = internalGetProps<PropertiesMessageProps>(req);
  props?._customProperties?.delete(property);
}

const throwNotSet = () => {
  throw new Error('property has not been set');
};
