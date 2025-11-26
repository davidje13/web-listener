import type { IncomingHttpHeaders } from 'node:http';
import { extname } from 'node:path';
import { internalOverrideFlags } from '../../util/regexpFlags.mts';
import { readHTTPQualityValues, type QualityValue } from './headers.mts';

const HEADERS = {
  mime: 'accept',
  language: 'accept-language',
  encoding: 'accept-encoding',
};

type NegotiationType = keyof typeof HEADERS;

export interface FileNegotiation {
  type: NegotiationType;
  options: FileNegotiationOption[];
}

export interface FileNegotiationOption {
  /**
   * Value to match in `Accept-*` header.
   * The comparison is case-insensitive.
   *
   * @example 'gzip'
   * @example 'en-GB'
   * @example /^en/
   * @example 'text/html'
   * @example /^text\//
   */
  match: string | RegExp;

  /**
   * Override value to return in `Content-Type` or `Content-Encoding`.
   * You can use this to give a concrete type when matching against a wildcard:
   *
   * @example { match: 'text/*', as: 'text/plain', file: '{base}.txt' }
   */
  as?: string | undefined;

  /**
   * Filename modifier to apply. Several tokens are available:
   *
   * - `{file}` - the original filename (does not include the path)
   * - `{base}` - the part of the original filename before the last `.` (or the entire filename if there is no dot)
   * - `{ext}` - the original file extension, including the `.` (or blank of there is no dot)
   *
   * The resulting filename must not contain any path components (i.e. `/` and `\` are not allowed)
   *
   * @example '{file}.gz'
   * @example '{base}-en{ext}'
   * @example 'negotiated-{file}'
   */
  file: string;
}

type FileEncodingFormat = 'zstd' | 'br' | 'gzip' | 'deflate' | 'identity';

const ENCODING_MAPPING_LOOKUP = /*@__PURE__*/ new Map<FileEncodingFormat, string>([
  ['zstd', '{file}.zst'],
  ['br', '{file}.br'],
  ['gzip', '{file}.gz'],
  ['deflate', '{file}.deflate'],
  ['identity', '{file}'],
]);

export const negotiateEncoding = (
  options: FileEncodingFormat[] | Record<FileEncodingFormat, string>,
): FileNegotiation => ({
  type: 'encoding',
  options: internalReadMap(options, ENCODING_MAPPING_LOOKUP),
});

function internalReadMap<T extends string>(
  items: T[] | Record<T, string>,
  lookup: Map<T, string>,
): { match: T; file: string }[] {
  if (Array.isArray(items)) {
    return items.map((format) => ({ match: format, file: lookup.get(format)! }));
  } else {
    return Object.entries(items).map(([match, file]) => ({
      match: match as T,
      file: file as string,
    }));
  }
}

export interface NegotiationOutputInfo {
  /** The negotiated mime type for the resolved file */
  mime?: string | undefined;
  /** The negotiated language for the resolved file */
  language?: string | undefined;
  /** The negotiated encoding for the resolved file */
  encoding?: string | undefined;
}

export interface NegotiationOutput {
  filename: string;
  info: NegotiationOutputInfo;
}

interface InternalRule {
  _type: NegotiationType;
  _options: InternalOption[];
}

interface InternalOption {
  _match: string | RegExp;
  _as: string | undefined;
  _file: string;
}

export class Negotiator {
  /** @internal */ declare private readonly _normalisedRules: InternalRule[];
  /** @internal */ declare private readonly _maxFailedAttempts: number;
  declare public readonly vary: string;

  /**
   * Content negotiation rules.
   *
   * This can be used to respond to the `Accept`, `Accept-Language`, and `Accept-Encoding` headers.
   *
   * For example: on a server with `foo.txt`, `foo.txt.gz`, and a negotiation rule mapping
   * `gzip` => `{name}.gz`:
   * - users requesting `foo.txt` may get `foo.txt.gz` with `Content-Encoding: gzip` if their
   *   client supports gzip encoding
   * - users requesting `foo.txt` may get `foo.txt` with no `Content-Encoding` if their client
   *   does not support gzip encoding
   *
   * Multiple rules can match simultaneously, if a specific enough file exists (for example you might
   * have `foo-en.txt.gz` for `Accept-Language: en` and `Accept-Encoding: gzip`).
   *
   * In the case of conflicting rules, earlier rules take priority (so `encoding` rules should
   * typically be specified last)
   *
   * See the helper `negotiateEncoding` for a simple way to support pre-compressed files.
   */
  constructor(rules: FileNegotiation[], { maxFailedAttempts = 10 } = {}) {
    this._normalisedRules = rules
      .map((rule): InternalRule => {
        if (!Object.prototype.hasOwnProperty.call(HEADERS, rule.type)) {
          throw new RangeError(`unknown rule type: ${rule.type}`);
        }
        return {
          _type: rule.type,
          _options: rule.options.map((option) => ({
            _file: option.file,
            _match:
              typeof option.match === 'string'
                ? option.match.toLowerCase()
                : internalOverrideFlags(option.match, true),
            _as: option.as ?? (typeof option.match === 'string' ? option.match : undefined),
          })),
        };
      })
      .filter((rule) => rule._options.length > 0);
    this._maxFailedAttempts = maxFailedAttempts;
    this.vary = [...new Set(this._normalisedRules.map((rule) => HEADERS[rule._type]))].join(' ');
  }

  options(
    base: string,
    reqHeaders: IncomingHttpHeaders,
  ): Generator<NegotiationOutput, undefined, undefined> {
    const negotiation = {
      mime: readHTTPQualityValues(reqHeaders['accept']),
      language: readHTTPQualityValues(reqHeaders['accept-language']),
      encoding: readHTTPQualityValues(reqHeaders['accept-encoding']),
    };
    let attempts = this._maxFailedAttempts;
    const rules = this._normalisedRules;
    const info: NegotiationOutputInfo = {};
    function* next(name: string, pos: number): Generator<NegotiationOutput> {
      const rule = rules[pos];
      if (!rule) {
        --attempts;
        yield { filename: name, info };
        return;
      }
      const seen = new Set<string>();
      const values = internalSortQuality(negotiation[rule._type]);
      const matchedOptions: (QualityValue & { _option: InternalOption })[] = [];
      for (const option of rule._options) {
        const firstMatch = values.find((v) =>
          typeof option._match === 'string'
            ? v.name.toLowerCase() === option._match
            : option._match.test(v.name),
        );
        if (firstMatch) {
          matchedOptions.push({ ...firstMatch, _option: option });
        }
      }
      for (const match of matchedOptions.sort(byQuality)) {
        const sub = internalMutateName(name, match._option._file);
        if (seen.has(sub)) {
          continue;
        }
        seen.add(sub);
        info[rule._type] = match._option._as;
        yield* next(sub, pos + 1);
        if (attempts <= 0) {
          return;
        }
      }
      info[rule._type] = undefined;
      if (!seen.has(name) && attempts > 0) {
        yield* next(name, pos + 1);
      }
    }
    return next(base, 0);
  }
}

function internalSortQuality(list: QualityValue[] | undefined): QualityValue[] {
  if (!list?.length) {
    return [];
  }
  if (list.length === 1) {
    return list;
  }
  return [...list].sort(byQuality);
}

const byQuality = <T extends QualityValue>(a: T, b: T) =>
  b.q - a.q || b.specificity - a.specificity;

export function internalMutateName(original: string, mutation: string) {
  return mutation.replaceAll(/\{(?:file|base|ext)\}/g, (param) =>
    param === '{file}'
      ? original
      : param === '{base}'
        ? original.replace(/\.[^.]*$/, '')
        : extname(original),
  );
}
