import { extname } from 'node:path';
import { internalOverrideFlags } from '../../util/regexpFlags.mts';
import type { QualityValue } from './headers.mts';

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

const ENCODING_MAPPING = {
  zstd: '{file}.zst',
  br: '{file}.br',
  gzip: '{file}.gz',
  deflate: '{file}.deflate',
  identity: '{file}',
};

type FileEncodingFormat = keyof typeof ENCODING_MAPPING;

export const negotiateEncoding = (
  options: FileEncodingFormat[] | Record<FileEncodingFormat, string>,
): FileNegotiation => ({
  type: 'encoding',
  options: internalReadMap(options, ENCODING_MAPPING).map(([match, file]) => ({ match, file })),
});

function internalReadMap<T extends string>(
  items: T[] | Record<T, string>,
  lookup: Record<T, string>,
): [T, string][] {
  if (Array.isArray(items)) {
    return items.map((format) => [format, lookup[format]] as const);
  } else {
    return Object.entries(items) as [T, string][];
  }
}

export interface NegotiationOutputInfo {
  mime?: string | undefined;
  language?: string | undefined;
  encoding?: string | undefined;
}

export interface NegotiationOutput {
  filename: string;
  info: NegotiationOutputInfo;
}

export type NegotiationInput = Partial<Record<NegotiationType, QualityValue[] | undefined>>;

export interface Negotiator {
  options(
    base: string,
    negotiation: NegotiationInput,
  ): Generator<NegotiationOutput, undefined, undefined>;
  vary: string;
}

export function makeNegotiator(rules: FileNegotiation[], maxFailedAttempts = 10): Negotiator {
  const normalisedRules = rules
    .map((rule) => ({
      _type: rule.type,
      _options: rule.options.map((option) => ({
        _file: option.file,
        _match:
          typeof option.match === 'string'
            ? option.match.toLowerCase()
            : internalOverrideFlags(option.match, true),
        _as: option.as ?? (typeof option.match === 'string' ? option.match : undefined),
      })),
    }))
    .filter((rule) => rule._options.length > 0);

  return {
    options(base, negotiation) {
      let attempts = maxFailedAttempts;
      const info: NegotiationOutputInfo = {};
      const normNegotiation: NegotiationInput = {
        mime: internalSortQuality(negotiation.mime),
        language: internalSortQuality(negotiation.language),
        encoding: internalSortQuality(negotiation.encoding),
      };
      function* next(name: string, pos: number): Generator<NegotiationOutput> {
        const rule = normalisedRules[pos];
        if (!rule) {
          --attempts;
          yield { filename: name, info };
          return;
        }
        const seen = new Set<string>();
        const values = normNegotiation[rule._type] ?? [];
        for (const value of values) {
          const normValue = value.name.toLowerCase();
          for (const option of rule._options) {
            const match =
              typeof option._match === 'string'
                ? option._match === normValue
                : option._match.test(normValue);
            if (match) {
              const sub = internalMutateName(name, option._file);
              if (seen.has(sub)) {
                continue;
              }
              seen.add(sub);
              info[rule._type] = option._as;
              yield* next(sub, pos + 1);
              if (attempts <= 0) {
                return;
              }
            }
          }
        }
        info[rule._type] = undefined;
        if (!seen.has(name) && attempts > 0) {
          yield* next(name, pos + 1);
        }
      }
      return next(base, 0);
    },
    vary: [...new Set(normalisedRules.map((rule) => HEADERS[rule._type]))].join(' '),
  };
}

function internalSortQuality(list: QualityValue[] | undefined): QualityValue[] | undefined {
  if (!list?.length) {
    return undefined;
  }
  if (list.length === 1) {
    return list;
  }
  return [...list].sort((a, b) => b.q - a.q || b.specificity - a.specificity);
}

function internalMutateName(original: string, mutation: string) {
  return mutation.replaceAll(/\{(?:file|base|ext)\}/g, (param) =>
    param === '{file}'
      ? original
      : param === '{base}'
        ? original.replace(/\.[^.]*$/, '')
        : extname(original),
  );
}
