import { internalRegExpEscape } from '../polyfill/regExpEscape.mts';

type ParameterPrefixes = [':', '*'];
type ParameterTerminators = ['/', '-', '.', ...ParameterPrefixes];

interface ParameterTypes {
  ':': string;
  '*': string[];
}

type Resplit<
  S extends [string, string, string],
  D extends string,
> = S[0] extends `${infer A}${D}${infer B}` ? [A, D, `${B}${S[1]}${S[2]}`] : S;

type ResplitRecur<S extends [string, string, string], Ds extends string[]> = Ds extends [
  infer D extends string,
  ...infer Rest extends string[],
]
  ? Resplit<ResplitRecur<S, Rest>, D>
  : S;

type SplitFirst<S extends string, Ds extends string[]> = ResplitRecur<[S, '', ''], Ds>;

type ReadParam<D, R extends [string, string, string]> = R[1] extends keyof ParameterTypes
  ? never
  : {
      [k in R[0]]: D extends keyof ParameterTypes ? ParameterTypes[D] : never;
    } & FindNextParam<SplitFirst<R[2], ParameterPrefixes>>;

type FindNextParam<S extends [string, string, string]> = S[1] extends ''
  ? {}
  : ReadParam<S[1], SplitFirst<S[2], ParameterTerminators>>;

type ReadParams<Path extends string> = FindNextParam<SplitFirst<Path, ParameterPrefixes>>;

export type ParametersFromPath<Path extends string> =
  Path extends `${infer Start}{${infer Optional}}${infer Rest}`
    ? ReadParams<Start> & Partial<ReadParams<Optional>> & ParametersFromPath<Rest>
    : ReadParams<Path>;

export interface NamedPathParameter {
  _name: string;
  _reader: (value: string | undefined) => unknown;
}

const READ_SINGLE_PARAM = (v: string | undefined) => v;
const READ_MULTI_PARAM = (v: string | undefined) =>
  v === undefined ? undefined : v === '' ? [] : v.split('/');
const READ_MULTI_PARAM_MERGE = (v: string | undefined) =>
  v === undefined ? undefined : v === '' ? [] : v.split('/').filter((o) => o);

export function internalCompilePathPattern(
  flagsAndPath: string,
  allowSubRoutes: boolean,
): {
  _pattern: RegExp;
  _parameters: NamedPathParameter[];
} {
  const patternParts = ['^'];
  const parameters: NamedPathParameter[] = [];
  const part = /[{}]|\/+|\\(.)|[:*]([a-zA-Z0-9_]*)/g;
  const [{ _caseInsensitive, _noMergeSlashes }, path] = internalPathFlags(flagsAndPath);
  if (path[0] !== '/') {
    throw new TypeError("path must begin with '/' or flags");
  }
  let p = 0;
  let optionalNesting = 0;
  for (const match of path.matchAll(part)) {
    if (match.index > p) {
      patternParts.push(internalRegExpEscape(path.substring(p, match.index)));
    }
    const token = match[0];
    if (token === '{') {
      patternParts.push('(?:');
      ++optionalNesting;
    } else if (token === '}') {
      if (optionalNesting === 0) {
        throw new TypeError(`unbalanced optional braces in path at ${match.index}`);
      }
      --optionalNesting;
      patternParts.push(')?');
    } else if (token[0] === '/') {
      patternParts.push(token);
      if (!_noMergeSlashes) {
        patternParts.push('+');
      }
    } else if (token[0] === '\\') {
      patternParts.push(internalRegExpEscape(match[1]!));
    } else {
      const type = token[0];
      const name = match[2];
      if (!name) {
        throw new TypeError(`unnamed parameter or unescaped '${type}' at ${match.index}`);
      }
      if (type === '*') {
        patternParts.push('(.*?)');
        parameters.push({
          _name: name,
          _reader: _noMergeSlashes ? READ_MULTI_PARAM : READ_MULTI_PARAM_MERGE,
        });
      } else {
        patternParts.push('([^/]+?)');
        parameters.push({ _name: name, _reader: READ_SINGLE_PARAM });
      }
    }
    p = match.index + token.length;
  }
  if (p < path.length) {
    patternParts.push(internalRegExpEscape(path.substring(p)));
  }
  if (optionalNesting > 0) {
    throw new TypeError('unbalanced optional braces in path');
  }
  if (allowSubRoutes) {
    // always require a slash before sub-routes, but this may have been consumed by a part of the pattern already, so allow a lookbehind
    patternParts.push('(?:');
    if (_noMergeSlashes) {
      patternParts.push('(?:(?<=/)|/)');
    } else {
      patternParts.push('(?:/+|(?<=/))');
    }
    patternParts.push('(?<rest>.*))?');
  }
  patternParts.push('$');
  return {
    _pattern: new RegExp(patternParts.join(''), _caseInsensitive ? 'i' : ''),
    _parameters: parameters,
  };
}

function internalFlagExtractor<K extends string>(available: Record<K, string>) {
  const defaults = {} as Record<K, boolean>;
  const lookup = new Map<string, K>();
  for (const [k, flag] of Object.entries(available)) {
    defaults[k as K] = false;
    lookup.set(flag as string, k as K);
  }
  return (str: string): [Record<K, boolean>, string] => {
    const flags = { ...defaults };
    for (let p = 0; p < str.length; ++p) {
      const found = lookup.get(str[p]!);
      if (found) {
        flags[found] = true;
      } else {
        return [flags, str.substring(p)];
      }
    }
    return [flags, ''];
  };
}

const internalPathFlags = /*@__PURE__*/ internalFlagExtractor({
  _caseInsensitive: 'i',

  // perform exact matching of slashes. By default, sequences of / match n *or more* slashes
  // (merging is on by default for security; see NGINX's rationale https://nginx.org/en/docs/http/ngx_http_core_module.html#merge_slashes)
  _noMergeSlashes: '!',
});
