import { Writable } from 'node:stream';
import type { Decoder } from '../../util/DecoderStream.mts';
import { VOID_BUFFER } from '../../util/voidBuffer.mts';
import { getTextDecoder } from '../../extras/registries/charset.mts';
import { HEX_VALUES, type ContentTypeParams } from './utils.mts';
import type { BusboyOptions } from './types.mts';

export class URLEncoded extends Writable {
  /** @internal */ private readonly _charset: string;
  /** @internal */ private readonly _fieldSizeLimit: number;
  /** @internal */ private readonly _fieldsLimit: number;
  /** @internal */ private readonly _fieldNameSizeLimit: number;

  /** @internal */ private _inKey: boolean;
  /** @internal */ private _keyTrunc: boolean;
  /** @internal */ private _valTrunc: boolean;
  /** @internal */ private _bytesKey: number;
  /** @internal */ private _bytesVal: number;
  /** @internal */ private _fields: number;
  /** @internal */ private _key: string[];
  /** @internal */ private _val: string[];
  /** @internal */ private _byte: number;
  /** @internal */ private _lastPos: number;
  /** @internal */ private _decoder: Decoder;

  constructor(
    { limits = {}, highWaterMark, defCharset = 'utf-8' }: BusboyOptions,
    conTypeParams: ContentTypeParams,
  ) {
    super({ autoDestroy: true, emitClose: true, highWaterMark });

    this._charset = conTypeParams.get('charset') ?? defCharset;

    this._fieldSizeLimit = limits.fieldSize ?? 1 * 1024 * 1024;
    this._fieldsLimit = limits.fields ?? Number.POSITIVE_INFINITY;
    this._fieldNameSizeLimit = limits.fieldNameSize ?? 100;

    this._inKey = true;
    this._keyTrunc = false;
    this._valTrunc = false;
    this._bytesKey = 0;
    this._bytesVal = 0;
    this._fields = 0;
    this._key = [];
    this._val = [];
    this._byte = -2;
    this._lastPos = 0;
    this._decoder = getTextDecoder(this._charset);
  }

  /** @internal */
  private _accumulate(buffer: Buffer, end: boolean) {
    const target = this._inKey ? this._key : this._val;
    const decoded = this._decoder.decode(buffer, { stream: !end });
    if (decoded) {
      target.push(decoded);
    }
  }

  override _write(chunk: Buffer, _: BufferEncoding, cb: (error?: Error | null) => void) {
    if (this._fields >= this._fieldsLimit) {
      return cb();
    }

    let i = 0;
    const len = chunk.length;
    this._lastPos = 0;

    // Check if we last ended mid-percent-encoded byte
    if (this._byte !== -2) {
      i = this._readPctEnc(chunk, i, len);
      if (i === -1) {
        return cb(new Error('Malformed urlencoded form'));
      }
      if (i >= len) {
        return cb();
      }
      if (this._inKey) {
        ++this._bytesKey;
      } else {
        ++this._bytesVal;
      }
    }

    main: while (i < len) {
      if (this._inKey) {
        // Parsing key

        i = this._skipKeyBytes(chunk, i, len);

        while (i < len) {
          switch (chunk[i]) {
            case 61: // '='
              this._accumulate(chunk.subarray(this._lastPos, i), true);
              this._lastPos = ++i;
              this._inKey = false;
              continue main;
            case 38: // '&'
              this._accumulate(chunk.subarray(this._lastPos, i), true);
              this._lastPos = ++i;
              if (this._key.length > 0) {
                this.emit('field', this._key.join(''), '', {
                  nameTruncated: this._keyTrunc,
                  valueTruncated: false,
                  encoding: this._charset,
                  mimeType: 'text/plain',
                });
                this._key.length = 0;
              }
              this._keyTrunc = false;
              this._bytesKey = 0;
              if (++this._fields >= this._fieldsLimit) {
                this.emit('fieldsLimit');
                return cb();
              }
              continue;
            case 43: // '+'
              if (this._lastPos < i) {
                this._accumulate(chunk.subarray(this._lastPos, i), false);
              }
              this._accumulate(BUF_SPACE, false);
              this._lastPos = i + 1;
              break;
            case 37: // '%'
              if (this._lastPos < i) {
                this._accumulate(chunk.subarray(this._lastPos, i), false);
              }
              this._lastPos = i + 1;
              this._byte = -1;
              i = this._readPctEnc(chunk, i + 1, len);
              if (i === -1) {
                return cb(new Error('Malformed urlencoded form'));
              }
              if (i >= len) {
                return cb();
              }
              ++this._bytesKey;
              i = this._skipKeyBytes(chunk, i, len);
              continue;
          }
          ++i;
          ++this._bytesKey;
          i = this._skipKeyBytes(chunk, i, len);
        }
        if (this._lastPos < i) {
          this._accumulate(chunk.subarray(this._lastPos, i), false);
        }
      } else {
        // Parsing value

        i = this._skipValBytes(chunk, i, len);

        while (i < len) {
          switch (chunk[i]) {
            case 38: // '&'
              this._accumulate(chunk.subarray(this._lastPos, i), true);
              this._lastPos = ++i;
              this._inKey = true;
              this.emit('field', this._key.join(''), this._val.join(''), {
                nameTruncated: this._keyTrunc,
                valueTruncated: this._valTrunc,
                encoding: this._charset,
                mimeType: 'text/plain',
              });
              this._key.length = 0;
              this._val.length = 0;
              this._keyTrunc = false;
              this._valTrunc = false;
              this._bytesKey = 0;
              this._bytesVal = 0;
              if (++this._fields >= this._fieldsLimit) {
                this.emit('fieldsLimit');
                return cb();
              }
              continue main;
            case 43: // '+'
              if (this._lastPos < i) {
                this._accumulate(chunk.subarray(this._lastPos, i), false);
              }
              this._accumulate(BUF_SPACE, false);
              this._lastPos = i + 1;
              break;
            case 37: // '%'
              if (this._lastPos < i) {
                this._accumulate(chunk.subarray(this._lastPos, i), false);
              }
              this._lastPos = i + 1;
              this._byte = -1;
              i = this._readPctEnc(chunk, i + 1, len);
              if (i === -1) {
                return cb(new Error('Malformed urlencoded form'));
              }
              if (i >= len) {
                return cb();
              }
              ++this._bytesVal;
              i = this._skipValBytes(chunk, i, len);
              continue;
          }
          ++i;
          ++this._bytesVal;
          i = this._skipValBytes(chunk, i, len);
        }
        if (this._lastPos < i) {
          this._accumulate(chunk.subarray(this._lastPos, i), false);
        }
      }
    }

    cb();
  }

  override _final(cb: (error?: Error | null) => void) {
    if (this._byte !== -2) {
      return cb(new Error('Malformed urlencoded form'));
    }
    this._accumulate(VOID_BUFFER, true);
    if (!this._inKey || this._key.length > 0) {
      this.emit('field', this._key.join(''), this._inKey ? '' : this._val.join(''), {
        nameTruncated: this._keyTrunc,
        valueTruncated: this._valTrunc,
        encoding: this._charset,
        mimeType: 'text/plain',
      });
    }
    cb();
  }

  /** @internal */
  private _readPctEnc(chunk: Buffer, pos: number, len: number) {
    if (pos >= len) {
      return len;
    }

    if (this._byte === -1) {
      // We saw a '%' but no hex characters yet
      const hexUpper = HEX_VALUES[chunk[pos++]!]!;
      if (hexUpper === -1) {
        return -1;
      }

      if (pos < len) {
        // Both hex characters are in this chunk
        const hexLower = HEX_VALUES[chunk[pos++]!]!;
        if (hexLower === -1) {
          return -1;
        }

        this._accumulate(Buffer.from([(hexUpper << 4) + hexLower]), false);

        this._byte = -2;
        this._lastPos = pos;
      } else {
        // Only one hex character was available in this chunk
        this._byte = hexUpper;
      }
    } else {
      // We saw only one hex character so far
      const hexLower = HEX_VALUES[chunk[pos++]!]!;
      if (hexLower === -1) {
        return -1;
      }

      this._accumulate(Buffer.from([(this._byte << 4) + hexLower]), false);

      this._byte = -2;
      this._lastPos = pos;
    }

    return pos;
  }

  /** @internal */
  private _skipKeyBytes(chunk: Buffer, pos: number, len: number) {
    // Skip bytes if we've truncated
    if (this._bytesKey > this._fieldNameSizeLimit) {
      if (!this._keyTrunc) {
        if (this._lastPos < pos) {
          this._accumulate(chunk.subarray(this._lastPos, pos - 1), false);
        }
      }
      this._keyTrunc = true;
      for (; pos < len; ++pos) {
        const code = chunk[pos];
        if (code === 61 /* '=' */ || code === 38 /* '&' */) {
          break;
        }
      }
      this._lastPos = pos;
    }

    return pos;
  }

  /** @internal */
  private _skipValBytes(chunk: Buffer, pos: number, len: number) {
    // Skip bytes if we've truncated
    if (this._bytesVal > this._fieldSizeLimit) {
      if (!this._valTrunc) {
        if (this._lastPos < pos) {
          this._accumulate(chunk.subarray(this._lastPos, pos - 1), false);
        }
      }
      this._valTrunc = true;
      for (; pos < len; ++pos) {
        if (chunk[pos] === 38 /* '&' */) {
          break;
        }
      }
      this._lastPos = pos;
    }

    return pos;
  }
}

const BUF_SPACE = /*@__PURE__*/ Buffer.from(' ', 'utf-8');
