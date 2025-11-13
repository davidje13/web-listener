import { Writable, type WritableOptions } from 'node:stream';
import type { Decoder } from '../../util/DecoderStream.mts';
import { getTextDecoder } from '../../extras/registries/charset.mts';
import { HEX_VALUES, type ContentTypeParams } from './utils.mts';
import type { BusboyOptions } from './types.mts';

export class URLEncoded extends Writable {
  /** @internal */ declare readonly _charset: string;
  /** @internal */ declare readonly _fieldSizeLimit: number;
  /** @internal */ declare readonly _fieldsLimit: number;
  /** @internal */ declare readonly _fieldNameSizeLimit: number;

  /** @internal */ declare _fields: number;
  /** @internal */ declare _inKey: boolean;
  /** @internal */ declare _current: string;
  /** @internal */ declare _currentLimit: number;
  /** @internal */ declare _currentHighNibble: number;
  /** @internal */ declare _key: string;
  /** @internal */ declare _keyTrunc: boolean;
  /** @internal */ declare _percentEncodedState: number;
  /** @internal */ declare _fastDecode: 0 | 1 | 2;
  /** @internal */ declare _decoder: Decoder;

  constructor(
    { limits = {}, highWaterMark, defCharset = 'utf-8' }: BusboyOptions,
    conTypeParams: ContentTypeParams,
  ) {
    super({
      autoDestroy: true,
      emitClose: true,
      highWaterMark,
      // use constructor form of registering internal methods to avoid issues with names being mangled due to starting with _
      write,
      final,
    } as WritableOptions<Writable>);

    // officially charset is not a supported parameter for application/x-www-form-urlencoded, but if it's present we will respect it
    this._charset = conTypeParams.get('charset') ?? defCharset;

    this._fieldSizeLimit = limits.fieldSize ?? 1 * 1024 * 1024;
    this._fieldsLimit = limits.fields ?? Number.POSITIVE_INFINITY;
    this._fieldNameSizeLimit = limits.fieldNameSize ?? 100;

    this._fields = 0;
    this._inKey = true;
    this._current = '';
    this._currentLimit = this._fieldNameSizeLimit;
    this._currentHighNibble = 0;
    this._key = '';
    this._keyTrunc = false;
    this._percentEncodedState = -2;
    this._fastDecode = /^utf-?8$/i.test(this._charset)
      ? 1
      : /^(latin-?1|iso[\-_]?8859-?1|(us-)?ascii)$/i.test(this._charset)
        ? 2
        : 0;
    this._decoder = getTextDecoder(this._charset);
  }
}

function write(
  this: URLEncoded,
  chunk: Buffer,
  _: BufferEncoding | undefined,
  cb: (error?: Error | null) => void,
) {
  if (!chunk.byteLength) {
    return cb();
  }
  if (this._fields >= this._fieldsLimit) {
    if (!this._fields && chunk !== AMP_BUFFER) {
      ++this._fields;
      this.emit('fieldsLimit');
    }
    return cb();
  }

  const len = chunk.byteLength;
  let pos = 0;

  // Check if we last ended mid-percent-encoded byte
  let pes = this._percentEncodedState;
  if (pes !== -2) {
    if (pes === -1) {
      // first hex character
      if ((pes = HEX_VALUES[chunk[pos++]!]!) === 16) {
        return cb(new Error('Malformed urlencoded form'));
      }
      this._currentHighNibble |= pes;
      if (pos === len) {
        this._percentEncodedState = pes;
        return cb();
      }
    }

    // second hex character
    const hexLower = HEX_VALUES[chunk[pos++]!]!;
    if (hexLower === 16) {
      return cb(new Error('Malformed urlencoded form'));
    }
    this._current += String.fromCharCode((pes << 4) + hexLower);
    this._percentEncodedState = -2;
    if (pos === len) {
      return cb();
    }
  }

  SPECIALS[PCT] = 1;
  SPECIALS[AMP] = 1;
  SPECIALS[PLUS] = 1;
  SPECIALS[EQ] = this._inKey ? 1 : 0;
  while (true) {
    const prev = pos;
    for (; pos < len && !SPECIALS[chunk[pos]!]; ++pos);
    if (pos > prev && this._currentLimit >= 0) {
      // surprisingly, using string concatenation here rather than just
      // keeping a list of chunks is ~2x faster (as of Node.js 24).
      // Using the undocumented .latin1Slice is ~1.5x faster than .toString('latin1')
      // (if the encoding is NOT latin1, we re-encode it later, which is still faster
      // than decoding as we go)
      if ((this._currentLimit -= pos - prev) < 0) {
        this._current += chunk.latin1Slice(prev, pos + this._currentLimit);
      } else {
        this._current += chunk.latin1Slice(prev, pos);
      }
    }
    if (pos === len) {
      return cb();
    }
    switch (chunk[pos++]!) {
      case PCT:
        // optimise for runs of percent-encoded characters, as they will rarely be alone
        while (true) {
          if (--this._currentLimit < 0) {
            SPECIALS[PCT] = 0;
            SPECIALS[PLUS] = 0;
            break;
          }
          if (pos === len) {
            this._percentEncodedState = -1;
            return cb();
          }

          // first hex character
          const hexUpper = HEX_VALUES[chunk[pos++]!]!;
          if (hexUpper === 16) {
            return cb(new Error('Malformed urlencoded form'));
          }
          this._currentHighNibble |= hexUpper;
          if (pos === len) {
            this._percentEncodedState = hexUpper;
            return cb();
          }

          // second hex character
          const hexLower = HEX_VALUES[chunk[pos++]!]!;
          if (hexLower === 16) {
            return cb(new Error('Malformed urlencoded form'));
          }
          this._current += String.fromCharCode((hexUpper << 4) + hexLower);
          if (pos === len) {
            return cb();
          }
          if (chunk[pos] !== PCT) {
            break;
          }
          pos++;
        }
        break;
      case AMP:
        const current =
          !this._fastDecode || (this._fastDecode === 1 && this._currentHighNibble & 8)
            ? this._decoder.decode(Buffer.from(this._current, 'latin1'))
            : this._current;
        if (!this._inKey) {
          this.emit('field', this._key, current, {
            nameTruncated: this._keyTrunc,
            valueTruncated: this._currentLimit < 0,
            encoding: this._charset,
            mimeType: 'text/plain',
          });
          this._key = '';
          this._keyTrunc = false;
          this._inKey = true;
          SPECIALS[EQ] = 1;
        } else if (current || this._currentLimit < 0) {
          this.emit('field', this._current, '', {
            nameTruncated: this._currentLimit < 0,
            valueTruncated: false,
            encoding: this._charset,
            mimeType: 'text/plain',
          });
        }
        SPECIALS[PCT] = 1;
        SPECIALS[PLUS] = 1;
        this._current = '';
        this._currentLimit = this._fieldNameSizeLimit;
        this._currentHighNibble = 0;
        if (++this._fields === this._fieldsLimit && chunk !== AMP_BUFFER) {
          this.emit('fieldsLimit');
          return cb();
        }
        break;
      case PLUS:
        if (--this._currentLimit < 0) {
          SPECIALS[PCT] = 0;
          SPECIALS[PLUS] = 0;
        } else {
          this._current += ' ';
        }
        break;
      case EQ:
        this._key =
          !this._fastDecode || (this._fastDecode === 1 && this._currentHighNibble & 8)
            ? this._decoder.decode(Buffer.from(this._current, 'latin1'))
            : this._current;
        this._keyTrunc = this._currentLimit < 0;
        this._inKey = false;
        SPECIALS[EQ] = 0;
        SPECIALS[PCT] = 1;
        SPECIALS[PLUS] = 1;
        this._current = '';
        this._currentHighNibble = 0;
        this._currentLimit = this._fieldSizeLimit;
        break;
    }
    if (pos === len) {
      return cb();
    }
  }
}

function final(this: URLEncoded, cb: (error?: Error | null) => void) {
  write.call(this, AMP_BUFFER, undefined, cb);
}

const PCT = 37; // %
const AMP = 38; // &
const PLUS = 43; // +
const EQ = 61; // =

const SPECIALS = /*@__PURE__*/ new Uint8Array(256);
const AMP_BUFFER = /*@__PURE__*/ Buffer.from([AMP]);
