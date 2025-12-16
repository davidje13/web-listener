import { TransformStream } from 'node:stream/web';
import { VOID_BUFFER } from './voidBuffer.mts';

export interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}

export interface Decoder {
  decode(input: Uint8Array, options?: { stream?: boolean | undefined }): string;
}

export type DecoderStream = TransformStream<Uint8Array, string>;

export class WrappedDecoderStream extends TransformStream<Uint8Array, string> {
  constructor(delegate: Decoder) {
    super({
      transform(chunk, controller) {
        try {
          const result = delegate.decode(chunk, { stream: true });
          if (result) {
            controller.enqueue(result);
          }
        } catch (error: unknown) {
          controller.error(error);
        }
      },
      flush(controller) {
        try {
          const result = delegate.decode(VOID_BUFFER);
          if (result) {
            controller.enqueue(result);
          }
        } catch (error: unknown) {
          controller.error(error);
        }
      },
    });
  }
}
