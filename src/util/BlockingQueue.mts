import { Queue } from './Queue.mts';

interface PendingPop<T> {
  _resolve: (value: T) => void;
  _reject: (err: unknown) => void;
  _tm: NodeJS.Timeout | null;
}

export class BlockingQueue<T> {
  /** @internal */ private readonly _pendingPush: Queue<T>;
  /** @internal */ private readonly _pendingShift: Queue<PendingPop<T>>;
  /** @internal */ private _state: number;
  /** @internal */ private _closeReason: unknown;

  constructor() {
    this._pendingPush = new Queue();
    this._pendingShift = new Queue();
    this._state = 0;
  }

  push(value: T) {
    if (this._state) {
      return;
    }
    const pending = this._pendingShift.shift();
    if (pending) {
      if (pending._tm) {
        clearTimeout(pending._tm);
      }
      pending._resolve(value);
    } else {
      this._pendingPush.push(value);
    }
  }

  shift(timeout?: number | undefined): Promise<T> {
    if (!this._pendingPush.isEmpty()) {
      return Promise.resolve(this._pendingPush.shift()!);
    }
    if (this._state) {
      return Promise.reject(this._closeReason);
    }
    return new Promise((resolve, reject) => {
      const pending: PendingPop<T> = { _resolve: resolve, _reject: reject, _tm: null };
      this._pendingShift.push(pending);
      if (timeout !== undefined) {
        pending._tm = setTimeout(() => {
          this._pendingShift.remove(pending);
          reject(new Error(`Timeout after ${timeout}ms`));
        }, timeout);
      }
    });
  }

  /** @internal */
  private _close(reason: unknown) {
    this._closeReason = reason;
    for (const pending of this._pendingShift) {
      pending._reject(reason);
      if (pending._tm) {
        clearTimeout(pending._tm);
      }
    }
  }

  close(reason: unknown) {
    if (!this._state) {
      this._state = 1;
      this._close(reason);
    }
  }

  fail(reason: unknown) {
    if (!this._state) {
      this._state = 2;
      this._close(reason);
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T, unknown, undefined> {
    return {
      next: () =>
        this.shift().then(
          (value) => ({ value, done: false }),
          (error) => {
            if (this._state === 2) {
              throw error;
            }
            return { value: null, done: true };
          },
        ),
    };
  }
}
