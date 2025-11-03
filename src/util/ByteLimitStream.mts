import { TransformStream } from 'node:stream/web';

interface Sizeable {
  readonly byteLength: number;
}

export class ByteLimitStream<T extends Sizeable> extends TransformStream<T, T> {
  constructor(limit: number, error: Error) {
    super({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > limit) {
          controller.error(error);
        } else {
          controller.enqueue(chunk);
        }
      },
    });
    let bytes = 0;
  }
}
