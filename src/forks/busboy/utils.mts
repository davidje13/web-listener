import type { Decoder } from '../../util/DecoderStream.mts';
import { internalSplitFirst } from '../../util/splitFirst.mts';
import { getTextDecoder } from '../../extras/registries/charset.mts';

export type ContentTypeParams = Map<string, string>;

export function parseContentType(str: string | undefined) {
  if (!str) {
    return null;
  }
  const [mime, paramsStr] = internalSplitFirst(str, ';');
  const params = new Map<string, string>();
  if (paramsStr) {
    const matcher =
      /\s*([!#-'*+\-.0-:>-Z^-z|~]+)=(?:([!#-'*+\-.0-:>-Z^-z|~]+)|"((?:[^\x00-\x08\x0a-\x1f"\\\x7f]|\\.)*)")\s*(;|$)/gy;
    while (matcher.lastIndex !== paramsStr.length) {
      const match = matcher.exec(paramsStr);
      if (!match) {
        return null;
      }
      const key = match[1]!.toLowerCase();
      const value = match[2] ?? match[3]?.replaceAll(/\\(.)/g, '$1') ?? '';
      if (!params.has(key)) {
        params.set(key, value);
      }
    }
  }
  return { mime: mime!.trim().toLowerCase(), params };
}

export function parseDisposition(buffer: Buffer, defDecoder: Decoder) {
  if (!buffer.byteLength) {
    return null;
  }

  const params = new Map<string, string>();
  let i = 0;
  for (; i < buffer.byteLength; ++i) {
    if (!TOKEN[buffer[i]!]) {
      if (!parseDispositionParams(buffer, i, params, defDecoder)) {
        return null;
      }
      break;
    }
  }

  return { type: buffer.latin1Slice(0, i).toLowerCase(), params };
}

function parseDispositionParams(
  buffer: Buffer,
  i: number,
  params: ContentTypeParams,
  defDecoder: Decoder,
): boolean {
  const L = buffer.byteLength;
  while (i < L) {
    // Consume whitespace
    for (; i < L; ++i) {
      const code = buffer[i];
      if (code !== 32 /* ' ' */ && code !== 9 /* '\t' */) {
        break;
      }
    }

    // Ended on whitespace
    if (i === L) {
      break;
    }

    // Check for malformed parameter
    if (buffer[i++] !== 59 /* ';' */) {
      return false;
    }

    // Consume whitespace
    for (; i < L; ++i) {
      const code = buffer[i];
      if (code !== 32 /* ' ' */ && code !== 9 /* '\t' */) {
        break;
      }
    }

    // Ended on whitespace (malformed)
    if (i === L) {
      return false;
    }

    const nameStart = i;
    // Parse parameter name
    for (; i < L; ++i) {
      const code = buffer[i]!;
      if (!TOKEN[code]) {
        if (code === 61 /* '=' */) {
          break;
        }
        return false;
      }
    }

    // No value (malformed)
    if (i === L) {
      return false;
    }

    const name = buffer.latin1Slice(nameStart, i).toLowerCase();
    if (name[name.length - 1] === '*') {
      // Extended value

      const charsetStart = ++i;
      // Parse charset name
      for (; i < L; ++i) {
        const code = buffer[i]!;
        if (!CHARSET[code]) {
          if (code !== 39 /* '\'' */) {
            return false;
          }
          break;
        }
      }

      // Incomplete charset (malformed)
      if (i === L) {
        return false;
      }

      const valueDecoder = getTextDecoder(buffer.latin1Slice(charsetStart, i));
      ++i; // Skip over the '\''

      // Parse language name
      for (; i < L; ++i) {
        if (buffer[i] === 39 /* '\'' */) {
          break;
        }
      }

      // Incomplete language (malformed)
      if (i === L) {
        return false;
      }

      ++i; // Skip over the '\''

      // No value (malformed)
      if (i === L) {
        return false;
      }

      let valueStart = i;

      // Parse value
      const valueParts: string[] = [];
      for (; i < L; ++i) {
        const code = buffer[i]!;
        if (EXTENDED_VALUE[code] !== 1) {
          if (code === 37 /* '%' */) {
            let hexUpper: number;
            let hexLower: number;
            if (
              i + 2 < L &&
              (hexUpper = HEX_VALUES[buffer[i + 1]!]!) !== 16 &&
              (hexLower = HEX_VALUES[buffer[i + 2]!]!) !== 16
            ) {
              const byteVal = (hexUpper << 4) + hexLower;
              if (i > valueStart) {
                valueParts.push(
                  valueDecoder.decode(buffer.subarray(valueStart, i), { stream: true }),
                );
              }
              valueParts.push(valueDecoder.decode(Buffer.from([byteVal]), { stream: true }));
              i += 2;
              valueStart = i + 1;
              continue;
            }
            // '%' disallowed in non-percent encoded contexts (malformed)
            return false;
          }
          break;
        }
      }

      valueParts.push(valueDecoder.decode(buffer.subarray(valueStart, i)));
      const value = valueParts.join('');
      if (!params.has(name)) {
        params.set(name, value);
      }
      continue;
    }

    // Non-extended value

    ++i; // Skip over '='

    // No value (malformed)
    if (i === L) {
      return false;
    }

    if (buffer[i] === 34 /* '"' */) {
      let valueStart = ++i;
      let escaping = false;
      // Parse quoted value
      const valueParts: string[] = [];
      for (; i < L; ++i) {
        const code = buffer[i]!;
        if (code === 92 /* '\\' */) {
          if (escaping) {
            valueStart = i;
            escaping = false;
          } else {
            valueParts.push(defDecoder.decode(buffer.subarray(valueStart, i), { stream: true }));
            escaping = true;
          }
          continue;
        }
        if (code === 34 /* '"' */) {
          if (escaping) {
            valueStart = i;
            escaping = false;
            continue;
          }
          valueParts.push(defDecoder.decode(buffer.subarray(valueStart, i)));
          break;
        }
        if (escaping) {
          valueStart = i - 1;
          escaping = false;
        }
        // Invalid unescaped quoted character (malformed)
        if (!QDTEXT[code]) {
          return false;
        }
      }

      // No end quote (malformed)
      if (i === L) {
        return false;
      }

      ++i; // Skip over double quote
      if (!params.has(name)) {
        params.set(name, valueParts.join(''));
      }
      continue;
    }

    let valueStart = i;
    // Parse unquoted value
    for (; i < L; ++i) {
      const code = buffer[i]!;
      if (!TOKEN[code]) {
        // No value (malformed)
        if (i === valueStart) {
          return false;
        }
        break;
      }
    }
    if (!params.has(name)) {
      params.set(name, defDecoder.decode(buffer.subarray(valueStart, i)));
    }
  }

  return true;
}

export const TOKEN = /*@__PURE__*/ (() => {
  const values = new Uint8Array(256);
  values.set(
    // prettier-ignore
    [
         1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 0, 1, 1, 0,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
      0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1,
    ],
    33,
  );
  return values;
})();

const EXTENDED_VALUE = /*@__PURE__*/ (() => {
  const values = new Uint8Array(TOKEN);
  values.set([0, 1, 0, 0, 0, 0], 37);
  return values;
})();

const CHARSET = /*@__PURE__*/ (() => {
  const values = new Uint8Array(TOKEN);
  values.set([0, 0, 0, 0, 1, 0, 1, 0], 39);
  values.set([1, 0, 1, 1], 123);
  return values;
})();

const QDTEXT = /*@__PURE__*/ (() => {
  const values = new Uint8Array(256);
  values.fill(1, 32, 256);
  values[0x09] = 1;
  values[0x22] = 0;
  values[0x5c] = 0;
  values[0x7f] = 0;
  return values;
})();

export const HEX_VALUES = /*@__PURE__*/ (() => {
  const values = new Uint8Array(256).fill(16);
  for (let i = 0; i < 10; ++i) {
    values[0x30 + i] = i;
  }
  for (let i = 0; i < 6; ++i) {
    values[0x41 + i] = i + 10;
    values[0x61 + i] = i + 10;
  }
  return values;
})();
