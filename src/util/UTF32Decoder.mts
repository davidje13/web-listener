import type { Decoder } from './DecoderStream.mts';

export class UTF32Decoder implements Decoder {
  /** @internal */ declare private readonly _le: boolean;
  /** @internal */ declare private readonly _fatal: boolean;
  /** @internal */ declare private readonly _carry: Uint8Array;
  /** @internal */ declare private readonly _carryDV: DataView;
  /** @internal */ declare private _carryN: number;

  constructor(littleEndian: boolean, { fatal = false }: TextDecoderOptions = {}) {
    this._le = littleEndian;
    this._fatal = fatal;
    this._carry = new Uint8Array(4);
    this._carryDV = new DataView(this._carry.buffer);
    this._carryN = 0;
  }

  decode(chunk: Uint8Array, { stream = false } = {}): string {
    const n = chunk.byteLength;
    const codepoints: number[] = [];
    let begin = 0;
    if (this._carryN > 0) {
      begin = 4 - this._carryN;
      if (n < begin) {
        this._carry.set(chunk, this._carryN);
        this._carryN += n;
        return '';
      }
      this._carry.set(chunk.subarray(0, begin), this._carryN);
      codepoints.push(this._carryDV.getUint32(0, this._le));
      this._carryN = 0;
    }
    const dv = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    let pos = begin;
    for (const stop = n - 3; pos < stop; pos += 4) {
      codepoints.push(dv.getUint32(pos, this._le));
    }
    if (stream) {
      if (pos < n) {
        this._carry.set(chunk.subarray(pos));
      }
      this._carryN = n - pos;
    } else {
      this._carryN = 0;
      if (pos < n) {
        if (this._fatal) {
          throw new Error('invalid byte length for utf-32 content');
        } else {
          codepoints.push(0xfffd);
        }
      }
    }
    if (codepoints.length > 0) {
      return String.fromCodePoint(...codepoints);
    } else {
      return '';
    }
  }
}
