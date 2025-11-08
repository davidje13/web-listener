/*
 * Copied from streamsearch@1.1.0 by Brian White
 * https://github.com/mscdex/streamsearch/tree/2df4e8db15b379f6faf0196a4ea3868bd3046e32
 *
 * Based heavily on the Streaming Boyer-Moore-Horspool C++ implementation
 * by Hongli Lai at: https://github.com/FooBarWidget/boyer-moore-horspool
 */

import { VOID_BUFFER } from '../../util/voidBuffer.mts';

export type StreamSearchCallback = (
  isMatch: boolean,
  data: Buffer,
  start: number,
  end: number,
  isSafeData: boolean,
) => void;

export class StreamSearch {
  /** @internal */ private readonly _needle: Buffer;
  /** @internal */ private readonly _cb: StreamSearchCallback;
  /** @internal */ private _lookbehind: Buffer;
  /** @internal */ private _lookbehindSize: number;
  /** @internal */ private _bufPos: number;
  /** @internal */ private readonly _occ: Uint16Array;

  constructor(needle: Buffer, callback: StreamSearchCallback) {
    const needleLen = needle.byteLength;
    if (!needleLen) {
      throw new Error('cannot search for empty needle');
    }
    this._needle = needle;
    this._cb = callback;
    this._lookbehind = Buffer.alloc(needleLen);
    this._lookbehindSize = 0;
    this._bufPos = 0;

    // Populate occurrence table with analysis of the needle, ignoring the last letter.
    this._occ = new Uint16Array(256).fill(needleLen);
    for (let i = 0; i < needleLen - 1; ++i) {
      this._occ[needle[i]!] = needleLen - 1 - i;
    }
  }

  push(chunk: Buffer, pos = 0) {
    this._bufPos = pos;
    const chunkLen = chunk.byteLength;
    while (this._feed(chunk) !== chunkLen);
  }

  destroy() {
    const lbSize = this._lookbehindSize;
    if (lbSize) {
      this._cb(false, this._lookbehind, 0, lbSize, false);
    }
    this._lookbehindSize = 0;
    this._bufPos = 0;
  }

  /** @internal */
  private _feed(data: Buffer) {
    const len = data.byteLength;
    const needle = this._needle;
    const needleLen = needle.byteLength;

    // Positive: points to a position in `data`
    //           pos == 3 points to data[3]
    // Negative: points to a position in the lookbehind buffer
    //           pos == -2 points to lookbehind[lookbehindSize - 2]
    let pos = -this._lookbehindSize;
    const lastNeedleCharPos = needleLen - 1;
    const lastNeedleChar = needle[lastNeedleCharPos];
    const end = len - needleLen;
    const occ = this._occ;
    const lookbehind = this._lookbehind;

    if (pos < 0) {
      // Lookbehind buffer is not empty. Perform Boyer-Moore-Horspool
      // search with character lookup code that considers both the
      // lookbehind buffer and the current round's haystack data.
      //
      // Loop until
      //   there is a match.
      // or until
      //   we've moved past the position that requires the
      //   lookbehind buffer. In this case we switch to the
      //   optimized loop.
      // or until
      //   the character to look at lies outside the haystack.
      while (pos < 0 && pos <= end) {
        const nextPos = pos + lastNeedleCharPos;
        const ch = nextPos < 0 ? lookbehind[this._lookbehindSize + nextPos]! : data[nextPos]!;

        if (ch === lastNeedleChar && this._matchNeedle(data, pos, lastNeedleCharPos)) {
          this._lookbehindSize = 0;
          if (pos > -this._lookbehindSize) {
            this._cb(true, lookbehind, 0, this._lookbehindSize + pos, false);
          } else {
            this._cb(true, VOID_BUFFER, 0, 0, true);
          }

          return (this._bufPos = pos + needleLen);
        }

        pos += occ[ch]!;
      }

      // No match.

      // There's too few data for Boyer-Moore-Horspool to run,
      // so let's use a different algorithm to skip as much as
      // we can.
      // Forward pos until
      //   the trailing part of lookbehind + data
      //   looks like the beginning of the needle
      // or until
      //   pos == 0
      while (pos < 0 && !this._matchNeedle(data, pos, len - pos)) {
        ++pos;
      }

      if (pos < 0) {
        // Cut off part of the lookbehind buffer that has
        // been processed and append the entire haystack
        // into it.
        const bytesToCutOff = this._lookbehindSize + pos;

        if (bytesToCutOff > 0) {
          // The cut off data is guaranteed not to contain the needle.
          this._cb(false, lookbehind, 0, bytesToCutOff, false);
        }

        this._lookbehindSize -= bytesToCutOff;
        lookbehind.copy(lookbehind, 0, bytesToCutOff, this._lookbehindSize);
        lookbehind.set(data, this._lookbehindSize);
        this._lookbehindSize += len;

        this._bufPos = len;
        return len;
      }

      // Discard lookbehind buffer.
      this._cb(false, lookbehind, 0, this._lookbehindSize, false);
      this._lookbehindSize = 0;
    }

    pos += this._bufPos;

    const firstNeedleChar = needle[0];

    // Lookbehind buffer is now empty. Perform Boyer-Moore-Horspool
    // search with optimized character lookup code that only considers
    // the current round's haystack data.
    while (pos <= end) {
      const ch = data[pos + lastNeedleCharPos]!;

      if (
        ch === lastNeedleChar &&
        data[pos] === firstNeedleChar &&
        memcmp(needle, 0, data, pos, lastNeedleCharPos)
      ) {
        if (pos > 0) {
          this._cb(true, data, this._bufPos, pos, true);
        } else {
          this._cb(true, VOID_BUFFER, 0, 0, true);
        }

        return (this._bufPos = pos + needleLen);
      }

      pos += occ[ch]!;
    }

    // There was no match. If there's trailing haystack data that we cannot
    // match yet using the Boyer-Moore-Horspool algorithm (because the trailing
    // data is less than the needle size) then match using a modified
    // algorithm that starts matching from the beginning instead of the end.
    // Whatever trailing data is left after running this algorithm is added to
    // the lookbehind buffer.
    while (pos < len) {
      if (data[pos] !== firstNeedleChar || !memcmp(data, pos, needle, 0, len - pos)) {
        ++pos;
        continue;
      }
      data.copy(lookbehind, 0, pos, len);
      this._lookbehindSize = len - pos;
      break;
    }

    // Everything until `pos` is guaranteed not to contain needle data.
    if (pos > 0) {
      this._cb(false, data, this._bufPos, pos < len ? pos : len, true);
    }

    this._bufPos = len;
    return len;
  }

  /** @internal */
  private _matchNeedle(data: Buffer, pos: number, len: number) {
    const lb = this._lookbehind;
    const lbSize = this._lookbehindSize;
    const needle = this._needle;

    for (let i = 0; i < len; ++i, ++pos) {
      const ch = pos < 0 ? lb[lbSize + pos] : data[pos];
      if (ch !== needle[i]) {
        return false;
      }
    }
    return true;
  }
}

function memcmp(buf1: Buffer, pos1: number, buf2: Buffer, pos2: number, num: number) {
  for (let i = 0; i < num; ++i) {
    if (buf1[pos1 + i] !== buf2[pos2 + i]) {
      return false;
    }
  }
  return true;
}
