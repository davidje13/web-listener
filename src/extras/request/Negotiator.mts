import type { IncomingHttpHeaders } from 'node:http';
import { extname } from 'node:path';
import { stringPredicate } from '../../util/regexpFlags.mts';
import { readHTTPQualityValues, type QualityValue } from './headers.mts';

const FEATURES = {
  type: { _requestHeader: 'accept', _responseHeader: 'content-type' },
  language: { _requestHeader: 'accept-language', _responseHeader: 'content-language' },
  encoding: { _requestHeader: 'accept-encoding', _responseHeader: 'content-encoding' },
} satisfies Record<
  string,
  { _requestHeader: keyof IncomingHttpHeaders; _responseHeader: keyof NegotiationOutputHeaders }
>;

type NegotiationFeature = keyof typeof FEATURES;

export interface FileNegotiation {
  /** Feature to negotiate ('type', 'language', or 'encoding') */
  feature: NegotiationFeature;
  /** Filename filter (only apply this negotiation for requests with filenames matching the pattern) */
  match?: string | RegExp;
  /** List of negotiation options available, ordered by server preference */
  options: FileNegotiationOption[];
}

export interface FileNegotiationOption {
  /**
   * Value to send in response `Content-*` header.
   * This is also used as a default (case-insensitive) request `Accept-*` comparison if no `for` pattern is given.
   *
   * @example 'gzip'
   * @example 'en-GB'
   * @example 'text/html'
   */
  value: string;

  /**
   * Optional wildcard matcher for the `Accept-*` header.
   *
   * @example { value: 'text/plain', for: /^text\//, file: '{base}.txt' }
   */
  for?: RegExp;

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
  feature: 'encoding',
  options: internalReadMap(options, ENCODING_MAPPING_LOOKUP),
});

function internalReadMap<T extends string>(
  items: T[] | Record<T, string>,
  lookup: Map<T, string>,
): { value: T; file: string }[] {
  if (Array.isArray(items)) {
    return items.map((value) => ({ value, file: lookup.get(value)! }));
  } else {
    return Object.entries(items).map(([value, file]) => ({
      value: value as T,
      file: file as string,
    }));
  }
}

export type NegotiationOutputHeaders = {
  /** The negotiated mime type for the resolved file */
  'content-type'?: string;

  /** The negotiated language for the resolved file */
  'content-language'?: string;

  /** The negotiated encoding for the resolved file */
  'content-encoding'?: string;

  /** A list of request headers which were considered when negotiating this file */
  vary?: string;
} & Record<string, string>;

export interface NegotiationOutput {
  filename: string;
  /** Response headers relevant to the negotiation */
  headers: NegotiationOutputHeaders;
}

interface InternalRule {
  _feature: NegotiationFeature;
  _match: (value: string) => boolean;
  _options: InternalOption[];
}

interface InternalOption {
  _value: string;
  _match: (value: string) => boolean;
  _file: string;
}

export class Negotiator {
  /** @internal */ declare private readonly _normalisedRules: InternalRule[];
  /** @internal */ declare private readonly _maxFailedAttempts: number;

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
        if (!Object.prototype.hasOwnProperty.call(FEATURES, rule.feature)) {
          throw new RangeError(`unknown negotiation feature: ${rule.feature}`);
        }
        return {
          _feature: rule.feature,
          _match: stringPredicate(rule.match, true),
          _options: rule.options.map((option) => ({
            _file: option.file,
            _value: option.value,
            _match: stringPredicate(option.for ?? option.value, true),
          })),
        };
      })
      .filter((rule) => rule._options.length > 0);
    this._maxFailedAttempts = maxFailedAttempts;
  }

  *options(
    base: string,
    reqHeaders: IncomingHttpHeaders,
  ): Generator<NegotiationOutput, undefined, undefined> {
    const rules = this._normalisedRules;
    const attempts = new Set<string>();
    const limit = this._maxFailedAttempts;
    const headers: NegotiationOutputHeaders = {};
    const vary = new Set<string>();
    let varyChanged = false;

    function* next(name: string, pos: number): Generator<NegotiationOutput> {
      const rule = rules[pos];
      if (!rule) {
        if (!attempts.has(name)) {
          attempts.add(name);
          if (varyChanged) {
            headers.vary = [...vary].join(', ');
            varyChanged = false;
          }
          yield { filename: name, headers };
        }
        return;
      }
      if (!rule._match(base)) {
        yield* next(name, pos + 1);
        return;
      }
      const header = FEATURES[rule._feature];
      vary.add(FEATURES[rule._feature]._requestHeader);
      varyChanged = true;
      const values = readHTTPQualityValues(reqHeaders[header._requestHeader])?.sort(byQuality);
      if (!values?.length) {
        yield* next(name, pos + 1);
        return;
      }
      const seen = new Set<string>();
      const matchedOptions: (QualityValue & { _option: InternalOption })[] = [];
      for (const option of rule._options) {
        const firstMatch = values.find((v) => option._match(v.name));
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
        headers[header._responseHeader] = match._option._value;
        yield* next(sub, pos + 1);
        if (attempts.size >= limit) {
          return;
        }
      }
      delete headers[header._responseHeader];
      if (!seen.has(name) && attempts.size < limit) {
        yield* next(name, pos + 1);
      }
    }
    if (limit > 0) {
      yield* next(base, 0);
    }
    if (!attempts.has(base)) {
      if (varyChanged) {
        headers.vary = [...vary].join(', ');
      }
      yield { filename: base, headers };
    }
  }
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
