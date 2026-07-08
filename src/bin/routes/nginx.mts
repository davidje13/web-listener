import { UserError } from '../UserError.mts';

export class Mapper {
  declare private readonly _norm: (v: string) => string;
  declare private readonly _map: Map<string, string>;
  declare private readonly _patterns: { _key: RegExp; _target: string }[];
  declare private _fallback: string;

  constructor(caseSensitive: boolean) {
    this._norm = caseSensitive ? (v) => v : (v) => v.toLowerCase();
    this._map = new Map();
    this._patterns = [];
    this._fallback = '';
  }

  add(key: string, value: string) {
    if (key[0] === '/') {
      this._map.set(this._norm(key), value);
    } else if (key[0] === '~') {
      const caseSensitive = key[1] !== '*';
      const pattern = key.substring(caseSensitive ? 1 : 2);
      this._patterns.push({ _key: new RegExp(pattern, caseSensitive ? '' : 'i'), _target: value });
    } else {
      throw new UserError(`invalid URL: ${key}`);
    }
  }

  setDefault(value: string) {
    this._fallback = value;
  }

  get(key: string) {
    const literal = this._map.get(this._norm(key));
    if (literal !== undefined) {
      return literal;
    }
    for (const p of this._patterns) {
      p._key.lastIndex = 0;
      const m = p._key.exec(key);
      if (m) {
        return p._target.replaceAll(/\$(?:([0-9]+)|([a-zA-Z][a-zA-Z0-9]*))/g, (_, id, name) => {
          if (id) {
            return m[Number.parseInt(id)] ?? '';
          } else if (m.groups && Object.prototype.hasOwnProperty.call(m.groups, name)) {
            return m.groups[name] ?? '';
          } else {
            return '';
          }
        });
      }
    }
    return this._fallback;
  }
}

export function* nginxTokenise(source: string) {
  let statement: { token: string; literal: boolean }[] = [];
  const token =
    /(\s+|#[^\n]*)|(;)|(?:"((?:[^"\\]+|\\.)*)")|(?:'((?:[^'\\]+|\\.)*)')|((?:[^#;\s\\"']+|\\.)+)/y;
  while (token.lastIndex < source.length) {
    const m = token.exec(source);
    if (!m) {
      throw new UserError('invalid nginx syntax');
    }
    const [, separator, semicolon, dquot, squot, nquot] = m;
    if (separator) {
      continue;
    }
    if (semicolon) {
      yield statement;
      statement = [];
      continue;
    }
    if (nquot && !nquot.includes('\\')) {
      statement.push({ token: nquot, literal: true });
    } else {
      const part = dquot ?? squot ?? nquot;
      if (part === undefined) {
        throw new Error('nginx tokenisation error');
      }
      statement.push({ token: part.replaceAll(/\\(.)/g, '$1'), literal: false });
    }
  }
  if (statement.length) {
    throw new UserError('unterminated statement - ensure all statements end with a semicolon');
  }
}
