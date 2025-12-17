/*
 * Adapted from streamsearch@1.1.0 by Brian White
 * https://github.com/mscdex/streamsearch/tree/2df4e8db15b379f6faf0196a4ea3868bd3046e32
 * based on https://github.com/FooBarWidget/boyer-moore-horspool by Hongli Lai
 *
 * Heavily adapted for improved performance on recent versions of Node.js
 * (the original was written before Buffer.indexOf was fast)
 */

export type StreamSearchCallback = (
  data: Buffer,
  start: number,
  end: number,
  isSafeData: boolean,
) => void;

export class StreamSearch {
  /** @internal */ declare private readonly _needle: Buffer;
  /** @internal */ declare private readonly _cb: StreamSearchCallback;
  /** @internal */ declare private readonly _needleCb: () => void;
  /** @internal */ declare private _lookbehind: Buffer | null;
  /** @internal */ declare private _lookbehindSize: number;
  /** @internal */ declare private _occ: Uint16Array | null;

  constructor(needle: Buffer, contentCallback: StreamSearchCallback, needleCallback: () => void) {
    const needleLen = needle.byteLength;
    if (!needleLen || needleLen > 65535) {
      throw new RangeError('invalid needle');
    }
    this._needle = needle;
    this._cb = contentCallback;
    this._needleCb = needleCallback;
    this._lookbehind = null;
    this._lookbehindSize = 0;
    this._occ = null;
  }

  push(data: Buffer) {
    let begin = 0;
    const len = data.byteLength;
    const needle = this._needle;
    const needleLenM1 = needle.byteLength - 1;
    const end = len - needleLenM1;

    // Positive: points to a position in `data`
    //           pos == 3 points to data[3]
    // Negative: points to a position in the lookbehind buffer
    //           pos == -2 points to lookbehind[lookbehindSize - 2]
    let pos = -this._lookbehindSize;

    if (this._lookbehindSize) {
      // Lookbehind buffer is not empty. Perform Boyer-Moore-Horspool
      // search with character lookup code that considers both the
      // lookbehind buffer and the current round's haystack data.

      // these properties are guaranteed to be set if lookbehindSize > 0
      const occ = this._occ!;
      const lookbehind = this._lookbehind!;

      const lastNeedleChar = needle[needleLenM1];
      if (pos < end) {
        // we already know the lookbehind buffer is a valid needle prefix, so
        // until we advance pos, we only need to check if data contains the
        // rest of the needle.
        const ch = data[pos + needleLenM1]!;
        if (
          ch === lastNeedleChar &&
          !data.compare(needle, -pos, needleLenM1, 0, pos + needleLenM1)
        ) {
          this._needleCb();
          this._lookbehindSize = 0;
          begin = pos += needleLenM1 + 1;
        } else {
          pos += occ[ch]!;
        }
      }

      // Loop until
      //   there is a match.
      // or until
      //   we've moved past the position that requires the
      //   lookbehind buffer. In this case we switch to the
      //   optimized loop.
      // or until
      //   the character to look at lies outside the haystack.
      const stop = end < 0 ? end : 0;
      while (pos < stop) {
        const ch = data[pos + needleLenM1]!;
        if (
          ch === lastNeedleChar &&
          !lookbehind.compare(needle, 0, -pos, this._lookbehindSize + pos, this._lookbehindSize) &&
          !data.compare(needle, -pos, needleLenM1, 0, pos + needleLenM1)
        ) {
          this._cb(lookbehind, 0, this._lookbehindSize + pos, false);
          this._needleCb();
          this._lookbehindSize = 0;
          begin = pos += needleLenM1 + 1;
          break;
        }
        pos += occ[ch]!;
      }

      // Drop as much of the lookbehind buffer as we can
      const lbSize = this._lookbehindSize;
      if (lbSize > 0) {
        const firstNeedleChar = needle[0]!;
        while (pos < 0) {
          const found = lookbehind.subarray(0, lbSize).indexOf(firstNeedleChar, lbSize + pos);
          if (found === -1) {
            pos = 0;
            break;
          }
          const lbStart = lbSize - found;
          if (
            !lookbehind.compare(needle, 1, lbStart, found + 1, lbSize) &&
            !data.compare(needle, lbStart, lbStart + len)
          ) {
            // Remove prefix from lookbehind buffer that can no-longer be part of the needle
            if (found) {
              this._cb(lookbehind, 0, found, false);
              lookbehind.copy(lookbehind, 0, found, lbStart);
            }

            // Append all of the current chunk
            lookbehind.set(data, lbStart);
            this._lookbehindSize += len - found;
            return;
          }
          pos = found + 1 - lbSize;
        }

        this._cb(lookbehind, 0, lbSize, false);
        this._lookbehindSize = 0;
      }
    }

    // Lookbehind buffer is now empty. Native Buffer.indexOf performs
    // efficient searching using various methods (including BMH)
    // https://github.com/nodejs/nbytes/blob/dac045c3a39f2a4ba87337d9642b6ffa66e99d4b/include/nbytes.h#L320
    // So use that to cover the bulk of the available data:
    while (pos < end) {
      const found = data.indexOf(needle, pos);
      if (found !== -1) {
        if (found > begin) {
          this._cb(data, begin, found, true);
        }
        this._needleCb();
        if (found === end + 1) {
          return;
        }
        begin = pos = found + needleLenM1 + 1;
      } else {
        pos = end;
      }
    }

    // There was no match. If there's trailing haystack data that we cannot
    // match yet (because the trailing data is less than the needle size) then
    // store it in the lookbehind buffer for the next chunk.
    const firstNeedleChar = needle[0]!;
    while (pos < len) {
      const found = data.indexOf(firstNeedleChar, pos);
      if (found === -1) {
        this._cb(data, begin, len, true);
        return;
      }
      if (!data.compare(needle, 1, len - found, found + 1)) {
        if (!this._lookbehind) {
          // Allocate lookbehind buffer and BMH lookup table on demand
          this._lookbehind = Buffer.allocUnsafe(needleLenM1);
          // Populate occurrence table with analysis of the needle, ignoring the last letter.
          this._occ = new Uint16Array(256).fill(needleLenM1 + 1);
          for (let i = 0; i < needleLenM1; ++i) {
            this._occ[needle[i]!] = needleLenM1 - i;
          }
        }
        data.copy(this._lookbehind, 0, found);
        this._lookbehindSize = len - found;
        if (found > begin) {
          this._cb(data, begin, found, true);
        }
        return;
      }
      pos = found + 1;
    }

    if (len > begin) {
      this._cb(data, begin, len, true);
    }
  }

  destroy() {
    const lbSize = this._lookbehindSize;
    if (lbSize && this._lookbehind) {
      this._cb(this._lookbehind, 0, lbSize, false);
    }
    this._lookbehindSize = 0;
  }
}
