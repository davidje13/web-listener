import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { SchemaObject } from 'ajv';

export const loadSchema = async (): Promise<SchemaObject> =>
  JSON.parse(
    await readFile(join(dirname(new URL(import.meta.url).pathname), 'schema.json'), 'utf-8'),
  );

export function makeSchemaParser<T>(schema: SchemaObject) {
  // ajv's auto-generated code is huge and has confusing error messages for invalid input, so we
  // roll our own which only attempts to support a tiny subset of the capabilities

  const convert = (part: SchemaObject): Mapper<unknown> => {
    const ref = part['$ref'];
    if (ref && ref.startsWith('#/$defs/')) {
      const refed = schema['$defs'][ref.substring(8)];
      if (!refed) {
        throw new Error(`unable to find ${ref} in schema`);
      }
      part = { ...refed, ...part };
    }
    const validator = makeValidator(part, convert);
    if (part['default'] !== undefined) {
      // ensure each caller gets a unique copy
      const def = JSON.stringify(part['default']);
      return (o, ctx) => validator(o === undefined ? JSON.parse(def) : o, ctx);
    }
    return (o, ctx) => (o === undefined ? undefined : validator(o, ctx));
  };
  return convert(schema) as Mapper<T>;
}

function makeValidator(
  part: SchemaObject,
  convert: (part: SchemaObject) => Mapper<unknown>,
): Mapper<unknown> {
  if (part['const'] !== undefined) {
    return mConst(part['const']);
  }
  if (part['enum']) {
    return mEnum(new Set(part['enum']));
  }
  if (part['anyOf']) {
    return mAnyOf(part['anyOf'].map(convert));
  }
  switch (part['type']) {
    case 'array':
      return mArray(convert(part['items']));
    case 'boolean':
      return mBoolean;
    case 'integer':
      return mNumber(true, part['minimum'], part['maximum']);
    case 'number':
      return mNumber(false, part['minimum'], part['maximum']);
    case 'object':
      const additional = part['additionalProperties'] ?? true;
      return mObject(
        new Map(
          Object.entries(part['properties'] ?? {}).map(([k, d]) => [k, convert(d as SchemaObject)]),
        ),
        typeof additional === 'object' ? convert(additional) : additional ? mAny : mNever,
        part['required'] ?? [],
      );
    case 'string':
      let pattern: RegExp | null = null;
      if (part['pattern']) {
        pattern = new RegExp(part['pattern']);
      }
      return mString(pattern, part['format'] ?? '');
    default:
      throw new Error(`unknown part type ${JSON.stringify(part)}`);
  }
}

const mConst =
  <T,>(value: T): Mapper<T> =>
  (o, ctx) => {
    if (o !== value) {
      throw new ConfigError(`expected ${JSON.stringify(value)}`, ctx, 8);
    }
    return value;
  };

const mEnum =
  <T,>(values: Set<T>): Mapper<T> =>
  (o, ctx) => {
    if (!values.has(o as T)) {
      throw new ConfigError(`expected one of ${JSON.stringify(values)}`, ctx, 7);
    }
    return o as T;
  };

const mAnyOf =
  <M extends Mapper<any>[]>(mappers: M): Mapper<Type<M[number]>> =>
  (o, ctx) => {
    const errors: unknown[] = [];
    let p = 9;
    for (const subMapper of mappers) {
      try {
        return subMapper(o, ctx);
      } catch (error: unknown) {
        if (error instanceof ConfigError) {
          if (error.p > p) {
            continue;
          }
          if (error.p !== p) {
            p = error.p;
            errors.length = 0;
          }
        } else {
          p = -1;
        }
        errors.push(error);
      }
    }
    throw errors.length === 1 ? errors[0] : new AggregateError(errors);
  };

const mArray =
  <T,>(itemMapper: Mapper<T>): Mapper<T[]> =>
  (o, ctx) => {
    if (!Array.isArray(o)) {
      throw new ConfigError(`expected list, got ${typeof o}`, ctx);
    }
    return o.map((v, i) => itemMapper(v, { ...ctx, path: `${ctx.path}[${i}]` }));
  };

const mBoolean: Mapper<boolean> = (o, ctx) => {
  if (typeof o !== 'boolean') {
    throw new ConfigError(`expected boolean, got ${typeof o}`, ctx);
  }
  return o;
};

const mNumber =
  (int: boolean, min: number | undefined, max: number | undefined): Mapper<number> =>
  (o, ctx) => {
    if (typeof o !== 'number') {
      throw new ConfigError(`expected number, got ${typeof o}`, ctx);
    }
    if (int && (o | 0) !== o) {
      throw new ConfigError(`expected integer, got ${o}`, ctx);
    }
    if (typeof min === 'number' && o < min) {
      throw new ConfigError(`value cannot be less than ${min}`, ctx);
    }
    if (typeof max === 'number' && o > max) {
      throw new ConfigError(`value cannot be greater than ${max}`, ctx);
    }
    return o;
  };

const mString =
  (pattern: RegExp | null, format: string): Mapper<string> =>
  (o, ctx) => {
    if (typeof o !== 'string') {
      throw new ConfigError(`expected string, got ${typeof o}`, ctx);
    }
    if (pattern && !pattern.test(o)) {
      throw new ConfigError(`expected string matching ${pattern}`, ctx);
    }
    if (format === 'uri-reference' && ctx.file) {
      if (o.startsWith('file://')) {
        return 'file://' + resolve(dirname(ctx.file), o.substring(7));
      } else if (!o.includes('://')) {
        return resolve(dirname(ctx.file), o);
      }
    }
    return o;
  };

const mObject =
  (
    known: Map<string, Mapper<unknown>>,
    other: Mapper<unknown>,
    required: string[],
  ): Mapper<object> =>
  (o, ctx) => {
    if (typeof o !== 'object') {
      throw new ConfigError(`expected object, got ${typeof o}`, ctx);
    }
    if (!o) {
      throw new ConfigError('expected object, got null', ctx);
    }
    if (Array.isArray(o)) {
      throw new ConfigError('expected object, got list', ctx);
    }
    const r: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (const [k, v] of Object.entries(o)) {
      seen.add(k);
      const valueMapper = known.get(k) ?? other;
      const val = valueMapper(v, { ...ctx, path: `${ctx.path}.${k}` });
      if (val !== undefined) {
        r[k] = val;
      }
    }
    for (const req of required) {
      if (r[req] === undefined) {
        throw new ConfigError(`missing required property ${JSON.stringify(req)}`, ctx);
      }
    }
    for (const [k, valueMapper] of known) {
      if (!seen.has(k)) {
        const val = valueMapper(undefined, { ...ctx, path: `${ctx.path}.${k}` });
        if (val !== undefined) {
          r[k] = val;
        }
      }
    }
    return r;
  };

const mAny: Mapper<unknown> = (o) => o;
const mNever: Mapper<never> = (_, ctx) => {
  throw new ConfigError('unknown property', ctx);
};

interface Context {
  file: string;
  path: string;
}

export type Mapper<T> = (o: unknown, context: Context) => T;
export type Type<T extends Mapper<any>> = ReturnType<T>;

class ConfigError extends Error {
  readonly p: number;

  constructor(message: string, ctx: Context, p: number = 0) {
    super(`${message} at ${ctx.path || 'root'}`);
    this.p = p;
  }
}
