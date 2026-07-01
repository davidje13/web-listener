import type EventEmitter from 'node:events';
import type { Mode } from 'node:fs';
import { constants, open, type FileHandle } from 'node:fs/promises';

export class SharedFileHandle {
  /** @internal */ declare private _path: string;
  /** @internal */ declare private _flags: number;
  /** @internal */ declare private _mode: Mode;
  /** @internal */ declare private _activeFileHandle: FileHandle | Promise<FileHandle> | undefined;
  /** @internal */ declare private _holders: number;
  /** @internal */ declare private _closeTm: NodeJS.Timeout | undefined;
  /** @internal */ declare private _closeDelay: number;

  constructor(path: string, flags = constants.O_RDONLY, mode: Mode = 0o666, closeDelay = 1000) {
    this._path = path;
    this._flags = flags;
    this._mode = mode;
    this._holders = 0;
    this._closeDelay = closeDelay;
  }

  countActive() {
    return this._holders;
  }

  async open(): Promise<FileHandle> {
    ++this._holders;
    clearTimeout(this._closeTm);
    this._closeTm = undefined;
    if (!this._activeFileHandle) {
      this._activeFileHandle = open(this._path, this._flags, this._mode).then((h) => {
        (h as unknown as EventEmitter).setMaxListeners(0); // we expect to potentially have lots of simultaneous access to this file handle
        this._activeFileHandle = h;
        return h;
      });
    }
    const wrapClose = (h: FileHandle) => {
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          this._close();
        }
        return Promise.resolve();
      };
      return new Proxy(h, {
        get: (target, p, ...rest) => (p === 'close' ? close : Reflect.get(target, p, ...rest)),
      });
    };
    if ('then' in this._activeFileHandle) {
      return this._activeFileHandle.then(wrapClose);
    } else {
      return wrapClose(this._activeFileHandle);
    }
  }

  /** @internal */ private _close() {
    if (!--this._holders) {
      clearTimeout(this._closeTm);
      this._closeTm = setTimeout(() => {
        this._closeTm = undefined;
        Promise.resolve(this._activeFileHandle).then((h) => {
          if (h && !this._holders) {
            this._activeFileHandle = undefined;
            h.close().catch(() => {});
          }
        });
      }, this._closeDelay).unref();
    }
  }
}
