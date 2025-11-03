import { TransformStream } from 'node:stream/web';

export class UTF32Decoder extends TransformStream<Uint8Array, string> {
  constructor(littleEndian: boolean) {
    super({
      transform(chunk, controller) {
        const n = chunk.byteLength;
        const codepoints: number[] = [];
        let begin = 0;
        if (carryN > 0) {
          begin = 4 - carryN;
          if (n < begin) {
            carry.set(chunk, carryN);
            carryN += n;
            return;
          }
          carry.set(chunk.subarray(0, begin), carryN);
          codepoints.push(carryDV.getUint32(0, littleEndian));
          carryN = 0;
        }
        const dv = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
        let pos = begin;
        for (const stop = n - 3; pos < stop; pos += 4) {
          codepoints.push(dv.getUint32(pos, littleEndian));
        }
        if (codepoints.length > 0) {
          controller.enqueue(String.fromCodePoint(...codepoints));
        }
        if (pos < n) {
          carry.set(chunk.subarray(pos));
          carryN = n - pos;
        }
      },
    });
    const carry = new Uint8Array(4);
    const carryDV = new DataView(carry.buffer);
    let carryN = 0;
  }
}
