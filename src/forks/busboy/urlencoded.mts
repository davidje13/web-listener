import { getTextDecoder } from '../../extras/registries/charset.mts';
import { HTTPError } from '../../core/HTTPError.mts';
import { HEX_VALUES, type ContentTypeParams } from './utils.mts';
import type { BusboyOptions, StreamConsumer } from './types.mts';

export function getURLEncodedFormFields(
  {
    defCharset = 'utf-8',
    maxNetworkBytes = Number.POSITIVE_INFINITY,
    maxContentBytes = maxNetworkBytes,
    maxFieldSize = 1 * 1024 * 1024,
    maxFieldNameSize = 100,
    maxFields = Number.POSITIVE_INFINITY,
  }: BusboyOptions,
  conTypeParams: ContentTypeParams,
): StreamConsumer {
  // officially charset is not a supported parameter for application/x-www-form-urlencoded, but if it's present we will respect it
  const charset = conTypeParams.get('charset') ?? defCharset;

  const fastDecode = /^utf-?8$/i.test(charset)
    ? 1
    : /^(latin-?1|iso[\-_]?8859-?1|(us-)?ascii)$/i.test(charset)
      ? 2
      : 0;
  const decoder = getTextDecoder(charset);

  return (source, callback) =>
    new Promise((resolve, reject) => {
      let networkRemaining = maxNetworkBytes;
      let contentRemaining = maxContentBytes;
      let fieldsRemaining = maxFields;
      let inKey = true;
      let current = '';
      let currentLimit = Math.min(maxFieldNameSize, contentRemaining);
      let currentHighNibble = 0;
      let key = '';
      let percentEncodedState = -2;

      const send = () => {
        const currentDecoded =
          !fastDecode || (fastDecode === 1 && currentHighNibble & 8)
            ? decoder.decode(Buffer.from(current, 'latin1'))
            : current;
        if (!inKey) {
          if (currentLimit < 0) {
            handleError(new HTTPError(413, { body: `value for ${JSON.stringify(key)} too long` }));
            return false;
          }
          callback({
            name: key,
            type: 'string',
            value: currentDecoded,
            encoding: charset,
            mimeType: 'text/plain',
          });
        } else if (currentLimit < 0) {
          handleError(
            new HTTPError(413, {
              body: `field name ${JSON.stringify(currentDecoded)}... too long`,
            }),
          );
          return false;
        } else if (currentDecoded) {
          callback({
            name: currentDecoded,
            type: 'string',
            value: '',
            encoding: charset,
            mimeType: 'text/plain',
          });
        }
        return true;
      };

      const handleData = (chunk: Buffer) => {
        if (!chunk.byteLength) {
          return;
        }
        if ((networkRemaining -= chunk.byteLength) < 0) {
          return handleError(new HTTPError(413, { body: 'content too large' }));
        }
        if (!fieldsRemaining) {
          return handleError(new HTTPError(413, { body: 'too many fields' }));
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
              contentRemaining -= pos - prev;
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
                --contentRemaining;
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
              inKey = true;
              // reset all specials (another task may have clobbered them during the yield)
              SPECIALS[EQ] = 1;
              SPECIALS[PCT] = 1;
              SPECIALS[PLUS] = 1;
              current = '';
              currentLimit = Math.min(maxFieldNameSize, contentRemaining);
              currentHighNibble = 0;
              if (!--fieldsRemaining) {
                return handleError(new HTTPError(413, { body: 'too many fields' }));
              }
              break;
            case PLUS:
              if (--currentLimit < 0) {
                SPECIALS[PCT] = 0;
                SPECIALS[PLUS] = 0;
              } else {
                --contentRemaining;
                current += ' ';
              }
              break;
            case EQ:
              key =
                !fastDecode || (fastDecode === 1 && currentHighNibble & 8)
                  ? decoder.decode(Buffer.from(current, 'latin1'))
                  : current;
              if (currentLimit < 0) {
                return handleError(
                  new HTTPError(413, { body: `field name ${JSON.stringify(key)}... too long` }),
                );
              }
              inKey = false;
              SPECIALS[EQ] = 0;
              SPECIALS[PCT] = 1;
              SPECIALS[PLUS] = 1;
              current = '';
              currentHighNibble = 0;
              currentLimit = Math.min(maxFieldSize, contentRemaining);
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

        // Emit final field
        if (!send()) {
          return;
        }
        source.off('data', handleData);
        source.off('end', handleEnd);
        source.off('error', handleError);
        resolve();
      };

      const handleError = (err: Error) => {
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
