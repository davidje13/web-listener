import { Readable } from 'node:stream';
import type { MaybePromise } from '../../util/MaybePromise.mts';

export class LoadOnDemand<T> {
  declare readonly load: () => MaybePromise<T>;

  constructor(load: () => MaybePromise<T>) {
    this.load = load;
  }
}

export const loadOnDemand = <T,>(load: () => MaybePromise<T>) => new LoadOnDemand(load);

export function dispose(entity: unknown): Promise<void> | undefined {
  if (entity && (typeof entity === 'object' || typeof entity === 'function')) {
    if (entity instanceof Readable) {
      entity.destroy();
      return;
    }
    if (Symbol.dispose && Symbol.dispose in entity) {
      (entity[Symbol.dispose] as () => void)();
      return;
    }
    if (Symbol.asyncDispose && Symbol.asyncDispose in entity) {
      return (entity[Symbol.asyncDispose] as () => Promise<void>)();
    }
    if ('return' in entity && typeof entity.return === 'function') {
      const p = entity.return();
      if (p instanceof Promise) {
        return p;
      }
      return;
    }
  }
  return;
}
