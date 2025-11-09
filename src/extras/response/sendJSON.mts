import { ServerResponse } from 'node:http';
import { Readable, type Writable } from 'node:stream';
import { internalDrainUncorked } from '../../util/drain.mts';
import { VOID_BUFFER } from '../../util/voidBuffer.mts';

export interface JSONOptions {
  replacer?: ((this: unknown, key: string, value: unknown) => unknown) | (number | string)[] | null;
  space?: string | number;
  undefinedAsNull?: boolean;
  encoding?: BufferEncoding;
  end?: boolean;
}

export function sendJSON(
  target: Writable,
  entity: unknown,
  { replacer, space, undefinedAsNull = false, encoding = 'utf-8', end = true }: JSONOptions = {},
) {
  const encoded =
    JSON.stringify(entity, replacer as any, space) ?? (undefinedAsNull ? 'null' : undefined);
  if (target instanceof ServerResponse && !target.headersSent) {
    if (!target.hasHeader('content-type')) {
      target.setHeader('content-type', 'application/json');
    }
    if (end) {
      target.setHeader('content-length', Buffer.byteLength(encoded, encoding));
    }
  }
  if (end) {
    target.end(encoded, encoding);
  } else if (encoded) {
    target.write(encoded, encoding);
  }
}

export async function sendJSONStream(
  target: Writable,
  entity: unknown,
  {
    replacer = null,
    space = '',
    undefinedAsNull = false,
    encoding = 'utf-8',
    end = true,
  }: JSONOptions = {},
) {
  if (Array.isArray(replacer)) {
    const items = new Set(replacer.map((v) => String(v)));
    replacer = function (k, v) {
      return this === null || Array.isArray(this) || items.has(k) ? v : undefined;
    };
  }
  if (typeof space === 'number') {
    space = '          '.substring(0, space);
  }
  const options: JSONPartOptions = {
    _send: (v: string) => target.write(v, encoding),
    _flush: () => internalDrainUncorked(target),
    _replacer: replacer,
    _space: space,
  };
  if (
    target instanceof ServerResponse &&
    !target.headersSent &&
    !target.hasHeader('content-type')
  ) {
    target.setHeader('content-type', 'application/json');
  }
  entity = internalConvert(null, '', entity, options);
  if (isSkip(entity)) {
    if (undefinedAsNull) {
      options._send('null');
    }
  } else {
    target.cork();

    // flush headers before we try streaming the content
    // (else the first token will be in its own chunk, despite using cork())
    target.write(VOID_BUFFER);

    try {
      await internalSendJSONPart(options, entity, space ? '\n' : '');
    } finally {
      target.uncork();
    }
  }
  if (end) {
    target.end();
  }
}

interface JSONPartOptions {
  _send: (v: string) => boolean;
  _flush: () => Promise<void>;
  _replacer: ((this: unknown, key: string, value: unknown) => unknown) | null;
  _space: string;
}

async function internalSendJSONPart(options: JSONPartOptions, entity: unknown, indent: string) {
  const loop = (prefix: string, suffix: string, keyed: boolean) => {
    options._send(prefix);
    const subIndent = indent + options._space;
    const sep = options._space ? ': ' : ':';
    let first = true;
    return {
      _next: async (key: string, value: unknown) => {
        const v = internalConvert(entity, key, value, options);
        if (!keyed || !isSkip(v)) {
          if (first) {
            first = false;
          } else {
            options._send(',');
          }
          options._send(subIndent);
          if (keyed) {
            if (!options._send(JSON.stringify(key))) {
              await options._flush();
            }
            options._send(sep);
          }
          await internalSendJSONPart(options, v, subIndent);
        }
      },
      _end: () => {
        if (!first) {
          options._send(indent);
        }
        options._send(suffix);
      },
    };
  };
  if (
    entity === null ||
    typeof entity !== 'object' ||
    entity instanceof String ||
    entity instanceof Number ||
    entity instanceof Boolean ||
    entity instanceof Function ||
    entity instanceof Symbol ||
    entity instanceof BigInt ||
    isRawJSON(entity)
  ) {
    if (!options._send(JSON.stringify(entity) ?? 'null')) {
      await options._flush();
    }
  } else if (entity instanceof Readable) {
    options._send('"');
    for await (const chunk of entity) {
      if (typeof chunk !== 'string') {
        throw new TypeError('Readables must have an encoding');
      }
      const encoded = JSON.stringify(chunk);
      if (!options._send(encoded.substring(1, encoded.length - 1))) {
        await options._flush();
      }
    }
    options._send('"');
  } else if (entity instanceof Map) {
    const act = loop('{', '}', true);
    for (const [k, v] of entity) {
      await act._next(k, v);
    }
    act._end();
  } else if (isIterable(entity)) {
    let i = 0;
    const act = loop('[', ']', false);
    for (const v of entity) {
      await act._next(String(i++), v);
    }
    act._end();
  } else if (isAsyncIterable(entity)) {
    let i = 0;
    const act = loop('[', ']', false);
    for await (const v of entity) {
      await act._next(String(i++), v);
    }
    act._end();
  } else {
    const act = loop('{', '}', true);
    for (const [k, v] of Object.entries(entity)) {
      await act._next(k, v);
    }
    act._end();
  }
}

function internalConvert(parent: unknown, key: string, entity: unknown, options: JSONPartOptions) {
  if (options._replacer) {
    entity = options._replacer.call(parent, key, entity);
  }
  if (entity && typeof entity === 'object' && typeof (entity as any).toJSON === 'function') {
    entity = (entity as any).toJSON(key);
  }
  return entity;
}

const isSkip = (x: unknown) =>
  x === undefined ||
  typeof x === 'function' ||
  typeof x === 'symbol' ||
  x instanceof Function ||
  x instanceof Symbol;
const isRawJSON = (x: {}): x is RawJSON => (JSON as any).isRawJSON?.(x) ?? false; // JSON.rawJSON / JSON.isRawJSON available in Node.js 21+
const isIterable = (x: {}): x is Iterable<unknown> => Symbol.iterator in x;
const isAsyncIterable = (x: {}): x is AsyncIterable<unknown> => Symbol.asyncIterator in x;

interface RawJSON {
  rawJSON: string;
}
