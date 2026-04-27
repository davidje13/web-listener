import type { IncomingMessage } from 'node:http';
import { HEX_VALUES } from '../forks/busboy/utils.mts';

export const internalParseURL = (req: IncomingMessage) =>
  new URL('http://localhost' + (req.url ?? '/'));

export function posEncoded(original: string, n: number) {
  // we assume the original is a valid encoding (it will already have been successfully read by decodeURIComponent)
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
    // we can detect utf-16 surrogate pairs as anything which is a 4-byte utf-8 code
    // (we can rely on this because overlong encodings such as [F0 80 80 80] are
    // already rejected by decodeURIComponent when the request begins)
    n -= r + (upper === 0xf ? 2 : 1);
  }
  if (n < 0 || p > original.length) {
    throw new RangeError();
  }
  return p;
}

const ENC_SIZE = [6, 6, 9, 12];
