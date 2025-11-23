import type { MaybePromise } from '../util/MaybePromise.mts';

let protoPromise: Promise<void>;
let protoDone: (() => void) | undefined;
let protoState = 0;
let n = 0;

// These functions mutate the global Object prototype for testing, so they are mutually exclusive.
// To avoid tests interfering with each other, they will automatically wait until conflicting tests have completed.

export const disableProtoThrow = (fn: () => MaybePromise<void>) => () =>
  withGlobalState(1, prepThrow, fn);
export const disableProtoDelete = (fn: () => MaybePromise<void>) => () =>
  withGlobalState(2, prepDelete, fn);

async function withGlobalState(id: number, prep: () => void, fn: () => MaybePromise<void>) {
  while (protoState && protoState !== id) {
    await protoPromise;
  }
  if (!protoState) {
    protoState = id;
    prep();
    protoPromise = new Promise<void>((resolve) => {
      protoDone = resolve;
    });
  }
  ++n;
  try {
    return await fn();
  } finally {
    if (!--n) {
      protoState = 0;
      protoDone?.();
    }
  }
}

function prepThrow() {
  Object.defineProperty(Object.prototype, '__proto__', {
    set: () => {
      throw new Error('attempted to set __proto__');
    },
    get: () => {
      throw new Error('attempted to get __proto__');
    },
  });
}

function prepDelete() {
  delete (Object.prototype as any).__proto__;
}
