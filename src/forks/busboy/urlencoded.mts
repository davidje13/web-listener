import { getTextDecoder } from '../../extras/registries/charset.mts';
import { HTTPError } from '../../core/HTTPError.mts';
import { HEX_VALUES, type ContentTypeParams } from './utils.mts';
import type { BusboyOptions, StreamConsumer } from './types.mts';

export function getURLEncodedFormFields(
  { limits = {}, defCharset = 'utf-8' }: BusboyOptions,
  conTypeParams: ContentTypeParams,
): StreamConsumer {
  // officially charset is not a supported parameter for application/x-www-form-urlencoded, but if it's present we will respect it
  const charset = conTypeParams.get('charset') ?? defCharset;
  const fieldSizeLimit = limits.fieldSize ?? 1 * 1024 * 1024;
  const fieldsLimit = limits.fields ?? Number.POSITIVE_INFINITY;
  const fieldNameSizeLimit = limits.fieldNameSize ?? 100;

  const fastDecode = /^utf-?8$/i.test(charset)
    ? 1
    : /^(latin-?1|iso[\-_]?8859-?1|(us-)?ascii)$/i.test(charset)
      ? 2
      : 0;
  const decoder = getTextDecoder(charset);

  return (source, callback) =>
    new Promise((resolve, reject) => {
      let fields = 0;
      let inKey = true;
      let current = '';
      let currentLimit = fieldNameSizeLimit;
      let currentHighNibble = 0;
      let key = '';
      let keyTrunc = false;
      let percentEncodedState = -2;

      const send = () => {
        try {
          const currentDecoded =
            !fastDecode || (fastDecode === 1 && currentHighNibble & 8)
              ? decoder.decode(Buffer.from(current, 'latin1'))
              : current;
          if (!inKey) {
            callback({
              name: key,
              _nameTruncated: keyTrunc,
              type: 'string',
              value: currentDecoded,
              _valueTruncated: currentLimit < 0,
              encoding: charset,
              mimeType: 'text/plain',
            });
          } else if (currentDecoded || currentLimit < 0) {
            callback({
              name: currentDecoded,
              _nameTruncated: currentLimit < 0,
              type: 'string',
              value: '',
              _valueTruncated: false,
              encoding: charset,
              mimeType: 'text/plain',
            });
          }
          return true;
        } catch (err: unknown) {
          handleError(err);
          return false;
        }
      };

      const handleData = (chunk: Buffer) => {
        if (!chunk.byteLength) {
          return;
        }
        if (fields >= fieldsLimit) {
          return handleError(new HTTPError(400, { body: 'too many fields' }));
        }

        const len = chunk.byteLength;
        let pos = 0;

        // Check if we last ended mid-percent-encoded byte
        let pes = percentEncodedState;
        if (pes !== -2) {
          if (pes === -1) {
            // first hex character
            if ((pes = HEX_VALUES[chunk[pos++]!]!) === 16) {
              return handleError(new HTTPError(400, { body: 'malformed urlencoded form' }));
            }
            currentHighNibble |= pes;
            if (pos === len) {
              percentEncodedState = pes;
              return;
            }
          }

          // second hex character
          const hexLower = HEX_VALUES[chunk[pos++]!]!;
          if (hexLower === 16) {
            return handleError(new HTTPError(400, { body: 'malformed urlencoded form' }));
          }
          current += String.fromCharCode((pes << 4) + hexLower);
          percentEncodedState = -2;
          if (pos === len) {
            return;
          }
        }

        SPECIALS[PCT] = 1;
        SPECIALS[AMP] = 1;
        SPECIALS[PLUS] = 1;
        SPECIALS[EQ] = inKey ? 1 : 0;
        while (true) {
          const prev = pos;
          for (; pos < len && !SPECIALS[chunk[pos]!]; ++pos);
          if (pos > prev && currentLimit >= 0) {
            // surprisingly, using string concatenation here rather than just
            // keeping a list of chunks is ~2x faster (as of Node.js 24).
            // Using the undocumented .latin1Slice is ~1.5x faster than .toString('latin1')
            // (if the encoding is NOT latin1, we re-encode it later, which is still faster
            // than decoding as we go)
            if ((currentLimit -= pos - prev) < 0) {
              current += chunk.latin1Slice(prev, pos + currentLimit);
            } else {
              current += chunk.latin1Slice(prev, pos);
            }
          }
          if (pos === len) {
            return;
          }
          switch (chunk[pos++]!) {
            case PCT:
              // optimise for runs of percent-encoded characters, as they will rarely be alone
              while (true) {
                if (--currentLimit < 0) {
                  SPECIALS[PCT] = 0;
                  SPECIALS[PLUS] = 0;
                  break;
                }
                if (pos === len) {
                  percentEncodedState = -1;
                  break;
                }

                // first hex character
                const hexUpper = HEX_VALUES[chunk[pos++]!]!;
                if (hexUpper === 16) {
                  return handleError(new HTTPError(400, { body: 'malformed urlencoded form' }));
                }
                currentHighNibble |= hexUpper;
                if (pos === len) {
                  percentEncodedState = hexUpper;
                  return;
                }

                // second hex character
                const hexLower = HEX_VALUES[chunk[pos++]!]!;
                if (hexLower === 16) {
                  return handleError(new HTTPError(400, { body: 'malformed urlencoded form' }));
                }
                current += String.fromCharCode((hexUpper << 4) + hexLower);
                if (pos === len) {
                  return;
                }
                if (chunk[pos] !== PCT) {
                  break;
                }
                pos++;
              }
              break;
            case AMP:
              if (!send()) {
                return;
              }
              key = '';
              keyTrunc = false;
              inKey = true;
              // reset all specials (another task may have clobbered them during the yield)
              SPECIALS[EQ] = 1;
              SPECIALS[PCT] = 1;
              SPECIALS[PLUS] = 1;
              current = '';
              currentLimit = fieldNameSizeLimit;
              currentHighNibble = 0;
              if (++fields === fieldsLimit) {
                return handleError(new HTTPError(400, { body: 'too many fields' }));
              }
              break;
            case PLUS:
              if (--currentLimit < 0) {
                SPECIALS[PCT] = 0;
                SPECIALS[PLUS] = 0;
              } else {
                current += ' ';
              }
              break;
            case EQ:
              key =
                !fastDecode || (fastDecode === 1 && currentHighNibble & 8)
                  ? decoder.decode(Buffer.from(current, 'latin1'))
                  : current;
              keyTrunc = currentLimit < 0;
              inKey = false;
              SPECIALS[EQ] = 0;
              SPECIALS[PCT] = 1;
              SPECIALS[PLUS] = 1;
              current = '';
              currentHighNibble = 0;
              currentLimit = fieldSizeLimit;
              break;
          }
          if (pos === len) {
            return;
          }
        }
      };

      const handleEnd = () => {
        // Check if we ended mid-percent-encoded byte
        if (percentEncodedState !== -2) {
          return handleError(new HTTPError(400, { body: 'malformed urlencoded form' }));
        }

        // Emit final field if we haven't already reached the limit
        if (fields < fieldsLimit) {
          if (!send()) {
            return;
          }
        }
        source.off('data', handleData);
        source.off('end', handleEnd);
        source.off('error', handleError);
        resolve();
      };

      const handleError = (err: unknown) => {
        source.off('data', handleData);
        source.off('end', handleEnd);
        source.off('error', handleError);
        reject(err);
      };

      source.on('data', handleData);
      source.once('end', handleEnd);
      source.once('error', handleError);
    });
}

const PCT = 37; // %
const AMP = 38; // &
const PLUS = 43; // +
const EQ = 61; // =

const SPECIALS = /*@__PURE__*/ new Uint8Array(256);
