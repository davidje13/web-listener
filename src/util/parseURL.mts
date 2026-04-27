import type { IncomingMessage } from 'node:http';
import { HEX_VALUES } from '../forks/busboy/utils.mts';

export const internalParseURL = (req: IncomingMessage) =>
  new URL('http://localhost' + (req.url ?? '/'));

export const makeDecodedCache = (path: string) =>
  decodeURIComponent(path.replaceAll(NON_DECODED, '%25$1'));
const NON_DECODED = /%(25|2f)/gi;

export const decodeSlashes = (v: string) => v.replaceAll(/%2f/gi, '/').replaceAll(/%25/g, '%');

export function posEncoded(original: string, n: number) {
  // we assume the original is a valid encoding (it will already have been successfully read by decodeURIComponent)
  // n is a position in the string returned by makeDecodedCache(original)

  let p = 0;
  while (n > 0) {
    const pct = original.indexOf('%', p);
    const r = pct - p;
    if (pct === -1 || r >= n) {
      p += n;
      break;
    }
    const upper = HEX_VALUES[original.charCodeAt(pct + 1)]!;
    p = pct + (ENC_SIZE[upper - 12] || 3);
    // %25 & %2f do not get decoded by makeDecodedCache, but are atomic.
    // For other values, we can detect utf-16 surrogate pairs as anything which is a 4-byte
    // utf-8 code (we can rely on this because overlong encodings such as [F0 80 80 80] are
    // already rejected by decodeURIComponent when the request begins)
    n -= r + (upper === 2 && '5fF'.includes(original[pct + 2]!) ? 3 : upper === 0xf ? 2 : 1);
  }
  if (n < 0 || p > original.length) {
    throw new RangeError();
  }
  return p;
}

const ENC_SIZE = [6, 6, 9, 12];
