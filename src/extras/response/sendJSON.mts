import { ServerResponse } from 'node:http';
import { Readable, type Writable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';
import { internalDrainUncorked } from '../../util/drain.mts';
import { VOID_BUFFER } from '../../util/voidBuffer.mts';
import { dispose, LoadOnDemand } from './LoadOnDemand.mts';

export interface JSONOptions {
  /**
   * Either a function to invoke on every object (recursive) to be printed, or a list of properties to filter for when printing objects (applies to nested objects too).
   * @default null
   */
  replacer?: ((this: unknown, key: string, value: unknown) => unknown) | (number | string)[] | null;
  /**
   * The amount of spacing to use for indentation. If this is 0, no spacing is used anywhere.
   * @default 0
   */
  space?: string | number | null;
  /**
   * If the top-level value being encoded is `undefined`, setting this to `true` will output `null`. `false` will output nothing.
   * @default false
   */
  undefinedAsNull?: boolean;
  /**
   * The text encoding to use. Note that only Unicode variants are permitted by the standard.
   * @default 'utf-8'
   */
  encoding?: BufferEncoding;
  /**
   * Whether to close the writable automatically after writing the JSON content.
   * @default true
   */
  end?: boolean;
}

export function sendJSON(
  target: Writable,
  entity: unknown,
  { replacer, space, undefinedAsNull = false, encoding = 'utf-8', end = true }: JSONOptions = {},
) {
  const encoded =
    JSON.stringify(entity, replacer as any, space ?? undefined) ??
    (undefinedAsNull ? 'null' : undefined);
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
    space = null,
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

  try {
    if (!target.writable) {
      return;
    }

    const options: JSONPartOptions = {
      _target: target,
      _send: (v: string) => target.write(v, encoding),
      _replacer: replacer,
      _space: space ?? '',
    };
    if (
      target instanceof ServerResponse &&
      !target.headersSent &&
      !target.hasHeader('content-type')
    ) {
      target.setHeader('content-type', 'application/json');
    }
    if (entity instanceof LoadOnDemand) {
      entity = await entity.load();
    }
    const v = internalConvert(null, '', entity, options);
    if (isSkip(v)) {
      if (undefinedAsNull) {
        options._send('null');
      }
    } else {
      target.cork();

      // flush headers before we try streaming the content
      // (else the first token will be in its own chunk, despite using cork())
      target.write(VOID_BUFFER);

      try {
        await internalSendJSONPart(options, v, space ? '\n' : '');
      } finally {
        target.uncork();
      }
    }
  } finally {
    const p = dispose(entity);
    if (p) {
      await p;
    }
  }
  if (end) {
    target.end();
  }
}

interface JSONPartOptions {
  _target: Writable;
  _send: (v: string) => boolean;
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
        if (!options._target.writable) {
          return;
        }
        if (value instanceof LoadOnDemand) {
          value = await value.load();
        }
        try {
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
                await internalDrainUncorked(options._target);
              }
              options._send(sep);
            }
            await internalSendJSONPart(options, v, subIndent);
          }
        } finally {
          const p = dispose(value);
          if (p) {
            await p;
          }
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
  if (!options._target.writable) {
    return;
  }
  if (
    entity === null ||
    typeof entity !== 'object' ||
    entity instanceof String ||
    entity instanceof Number ||
    entity instanceof Boolean ||
    entity instanceof Function ||
    entity instanceof Symbol ||
    entity instanceof BigInt ||
    JSON.isRawJSON(entity)
  ) {
    if (!options._send(JSON.stringify(entity) ?? 'null')) {
      await internalDrainUncorked(options._target);
    }
  } else if (entity instanceof Readable || entity instanceof ReadableStream) {
    options._send('"');
    for await (const chunk of entity) {
      if (typeof chunk !== 'string') {
        throw new TypeError('Readables must have an encoding');
      }
      if (!options._target.writable) {
        break;
      }
      const encoded = JSON.stringify(chunk);
      if (!options._send(encoded.substring(1, encoded.length - 1))) {
        await internalDrainUncorked(options._target);
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
      if (!options._target.writable) {
        break;
      }
      await act._next(String(i++), v);
    }
    act._end();
  } else if (isAsyncIterable(entity)) {
    let i = 0;
    const act = loop('[', ']', false);
    for await (const v of entity) {
      if (!options._target.writable) {
        break;
      }
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
const isIterable = (x: {}): x is Iterable<unknown> => Symbol.iterator in x;
const isAsyncIterable = (x: {}): x is AsyncIterable<unknown> => Symbol.asyncIterator in x;

// waiting on https://github.com/microsoft/TypeScript/pull/63248
declare global {
  interface JSON {
    isRawJSON(x: unknown): x is { rawJSON: string };
  }
}
