import EventEmitter from 'node:events';
import type { Readable } from 'node:stream';

export function createSafeReadStream<S extends Readable, O>(
  handle: {
    createReadStream(options: O): S;
    close?: () => Promise<void>;
  },
  options: O & { autoClose?: boolean | undefined },
): S {
  if (!(handle instanceof EventEmitter)) {
    return handle.createReadStream(options);
  }

  // this helper is a workaround for https://github.com/nodejs/node/issues/64214

  const wrappedHandle =
    handle.close && options.autoClose === false
      ? new Proxy(handle, {
          // stream must be destroyed on end, but will call handler.close, which we do not want.
          // swap out handler.close for the stream to prevent this
          get: (target, p, ...rest) =>
            p === 'close' ? () => Promise.resolve() : Reflect.get(target, p, ...rest),
        })
      : handle;
  const before = handle.listeners('close').length;
  const stream = wrappedHandle.createReadStream(options);
  const after = handle.listeners('close');
  const listener = after.length > before ? (after[after.length - 1] as () => void) : undefined;
  const onEnd = () => {
    if (listener) {
      // the close listener is not removed by Node.js, so we must remove it manually
      handle.off('close', listener);
    }
    // if we do not call destroy on the stream, the eventual call to handler.close will hang
    stream.destroy();
    stream.off('end', onEnd);
    stream.off('error', onError);
  };
  const onError = () => {
    handle.close?.();
    onEnd();
  };
  stream.once('end', onEnd);
  stream.once('error', onError);
  return stream;
}
