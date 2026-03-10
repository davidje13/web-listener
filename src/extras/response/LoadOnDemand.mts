import { Readable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';
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
      return void entity.destroy();
    }
    if (entity instanceof ReadableStream) {
      return entity.cancel();
    }
    if (Symbol.dispose && typeof (entity as any)[Symbol.dispose] === 'function') {
      return void (entity as any)[Symbol.dispose]();
    }
    if (Symbol.asyncDispose && typeof (entity as any)[Symbol.asyncDispose] === 'function') {
      return (entity as any)[Symbol.asyncDispose]();
    }
    if (typeof (entity as any).return === 'function') {
      const p = (entity as any).return();
      if (p instanceof Promise) {
        return p;
      }
      return;
    }
  }
  return;
}
