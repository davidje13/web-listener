import type { IncomingMessage } from 'node:http';
import { internalSplitFirst } from '../../util/splitFirst.mts';
import { HTTPError } from '../../core/HTTPError.mts';
import type { HTTPRange, RangePart } from '../range.mts';

export function getAuthorization(req: IncomingMessage): [string, string] | undefined {
  const auth = req.headers['authorization'];
  if (!auth) {
    return undefined;
  }
  const [type, data] = internalSplitFirst(auth, ' ');
  if (data === undefined) {
    return undefined;
  }
  return [type.trim().toLowerCase(), data.trim()];
}

export function getCharset(req: IncomingMessage) {
  // https://www.iana.org/assignments/character-sets/character-sets.xhtml
  const charsetMatch = /^text\/.*;\s*charset=([^;]+)/i.exec(req.headers['content-type'] ?? '');
  return charsetMatch?.[1]?.trim().toLowerCase() ?? undefined;
}

export function getIfRange(req: IncomingMessage): {
  etag?: string[] | undefined;
  modifiedSeconds?: number | undefined;
} {
  const raw = req.headers['if-range'];
  if (!raw || typeof raw !== 'string') {
    return {};
  }
  if (/^("|W\/")/.test(raw)) {
    return { etag: [raw] };
  }
  return { modifiedSeconds: readHTTPDateSeconds(raw) };
}

export interface GetRangeOptions {
  /**
   * Maximum number of sequential, non-overlapping ranges a client can request in a
   * single message.
   *
   * Typical browser clients only request a single range. In rare cases, clients may
   * request 2 ranges. Bespoke clients may be able to make use of more ranges.
   *
   * @default 10
   */
  maxRanges?: number;

  /**
   * Maximum number of ranges a client can request in a single message if any ranges are
   * non-sequential (i.e. a later range begins at lower offset than an earlier range).
   *
   * As suggested in https://datatracker.ietf.org/doc/html/rfc7233, this uses a default
   * limit of 2, as more ranges are likely to be a broken or malicious client.
   *
   * @default 2
   */
  maxNonSequential?: number;

  /**
   * Maximum number of ranges a client can request in a single message if any ranges are
   * overlapping.
   *
   * As suggested in https://datatracker.ietf.org/doc/html/rfc7233, this uses a default
   * limit of 2, as more ranges are likely to be a broken or malicious client.
   *
   * @default 2
   */
  maxWithOverlap?: number;
}

export function getRange(
  req: IncomingMessage,
  totalSize: number,
  { maxRanges = 10, maxNonSequential = 2, maxWithOverlap = 2 }: GetRangeOptions = {},
): HTTPRange | undefined {
  const raw = req.headers['range'];
  if (!raw || totalSize === 0) {
    return undefined;
  }
  const [unit, rawRanges] = internalSplitFirst(raw, '=');
  if (unit !== 'bytes' || !rawRanges) {
    return undefined;
  }
  const rangeNotSatisfiable = new HTTPError(416, {
    headers: { 'content-range': `bytes */${totalSize}` },
  });
  const safeParseInt = (v: string) => {
    const n = readHTTPInteger(v);
    if (n === undefined) {
      throw rangeNotSatisfiable;
    }
    return n;
  };
  const ranges: RangePart[] = [];
  for (const r of rawRanges.split(',')) {
    const [start, end] = internalSplitFirst(r.trim(), '-');
    if (end === undefined) {
      throw rangeNotSatisfiable;
    }
    let range: RangePart;
    if (!start) {
      if (!end) {
        throw rangeNotSatisfiable;
      }
      range = { start: Math.max(totalSize - safeParseInt(end), 0), end: totalSize - 1 };
    } else {
      range = {
        start: safeParseInt(start),
        end: end ? Math.min(safeParseInt(end), totalSize - 1) : totalSize - 1,
      };
    }
    if (range.start >= totalSize) {
      continue;
    }
    if (range.end < range.start || ranges.length >= maxRanges) {
      throw rangeNotSatisfiable;
    }

    ranges.push(range);
  }

  if (!ranges.length) {
    throw rangeNotSatisfiable;
  }
  if (ranges.length > maxNonSequential) {
    for (let i = 0; i < ranges.length - 1; ++i) {
      if (ranges[i]!.start > ranges[i + 1]!.start) {
        throw rangeNotSatisfiable;
      }
    }
  }
  if (ranges.length > maxWithOverlap) {
    for (let i = 1; i < ranges.length; ++i) {
      const r1 = ranges[i]!;
      for (let j = 0; j < i; ++j) {
        const r2 = ranges[j]!;
        if (r1.end >= r2.start && r2.end >= r1.start) {
          throw rangeNotSatisfiable;
        }
      }
    }
  }
  return { ranges, totalSize };
}

export interface QualityValue {
  name: string;
  specifiers: Map<string, string>;
  specificity: number;
  q: number;
}

// TODO: would be nice to provide common readers for types from https://www.rfc-editor.org/rfc/rfc8941.html

export function readHTTPUnquotedCommaSeparated(
  raw: LooseHeaderValue | undefined,
): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw === 'number') {
    return [String(raw)];
  }
  if (!raw.length) {
    return [];
  }
  if (typeof raw === 'string') {
    return raw.split(',').map((v) => v.trim());
  }
  return raw.flatMap((part) => part.split(',').map((v) => v.trim()));
}

export function readHTTPInteger(raw: string | undefined) {
  if (!raw || !/^\s*-?\d+\s*$/.test(raw)) {
    return undefined;
  }
  return Number.parseInt(raw, 10);
}

export function readHTTPQualityValues(raw: string | undefined): QualityValue[] | undefined {
  if (!raw) {
    return undefined;
  }
  return raw.split(',').map((item): QualityValue => {
    const [id, ...options] = item.split(';');
    const specifiers = new Map(
      options.map((o) => {
        const [k, v] = internalSplitFirst(o, '=');
        return [k.trim(), v?.trim() ?? ''];
      }),
    );
    const name = id!.trim();
    const specificity = name === '*/*' || name === '*' ? 0 : name.endsWith('/*') ? 1 : 2;
    const q = Math.max(0, Math.min(1, Number.parseFloat(specifiers.get('q') ?? '1')));
    return { name: name, specifiers, specificity, q };
  });
}

export function readHTTPKeyValues(raw: string): Map<string, string> {
  const result = new Map<string, string>();
  const matcher = /\s*([^=]+)=([^";]*?|"(?:[^\\"]|\\.)*")\s*(?:;|$)/y;
  while (matcher.lastIndex < raw.length) {
    const part = matcher.exec(raw);
    if (!part) {
      throw new HTTPError(400, { body: 'invalid HTTP key values' });
    }
    const key = part[1]!.toLowerCase();
    let value = part[2]!;
    if (value[0] === '"') {
      value = value.substring(1, value.length - 1).replaceAll(/\\(.)/g, (_, v) => v);
    }
    result.set(key, value);
  }
  return result;
}

export function readHTTPDateSeconds(raw: LooseHeaderValue | undefined): number | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  // Date.parse is not guaranteed to support RFC822 dates,
  // but in practice V8 (and therefore Node.js) does
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return (parsed / 1000) | 0;
}

export type LooseHeaderValue = string | number | string[];
