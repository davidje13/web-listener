export type Mapper<T> = (o: unknown, path?: string) => T;
export type Type<T extends Mapper<any>> = ReturnType<T>;

const type =
  <T,>(type: string): Mapper<T> =>
  (o, path = '') => {
    if (typeof o !== type) {
      throw new Error(`expected ${type}, got ${typeof o} at ${path}`);
    }
    return o as T;
  };

class ConstError extends Error {}

export const str = type<string>('string');
export const num = type<number>('number');
export const int: Mapper<number> = (o, path = '') => {
  if (typeof o !== 'number') {
    throw new Error(`expected integer, got ${typeof o} at ${path}`);
  }
  if ((o | 0) !== o) {
    throw new Error(`expected integer, got ${o} at ${path}`);
  }
  return o;
};
export const bool = type<boolean>('boolean');
export const lit =
  <T,>(value: T): Mapper<T> =>
  (o, path = '') => {
    if (o !== value) {
      throw new ConstError(`expected ${JSON.stringify(value)} at ${path}`);
    }
    return value;
  };
export const choice =
  <T,>(...values: T[]): Mapper<T> =>
  (o, path = '') => {
    if (!values.includes(o as T)) {
      throw new Error(
        `expected one of ${JSON.stringify(values)}, got ${JSON.stringify(o)} at ${path}`,
      );
    }
    return o as T;
  };
export const opt =
  <T, T2>(mapper: Mapper<T>, fallback: T2 | (() => T2)): Mapper<T | T2> =>
  (o, path = '') =>
    o === undefined
      ? typeof fallback === 'function'
        ? (fallback as () => T2)()
        : fallback
      : mapper(o, path);

export const obj =
  <T extends object>(structure: { [k in keyof T]: Mapper<T[k]> }): Mapper<T> =>
  (o, path = '') => {
    if (typeof o !== 'object') {
      throw new Error(`expected object, got ${typeof o} at ${path}`);
    }
    if (!o) {
      throw new Error(`expected object, got null at ${path}`);
    }
    if (Array.isArray(o)) {
      throw new Error(`expected object, got list at ${path}`);
    }
    const r = {} as T;
    const seen = new Set<string>();
    for (const [k, v] of Object.entries(o)) {
      seen.add(k);
      const key = k as keyof T;
      const mapper = structure[key];
      if (!mapper) {
        throw new Error(`unknown property ${path}.${k}`);
      }
      r[key] = mapper(v, `${path}.${k}`);
    }
    for (const k of Object.keys(structure)) {
      if (!seen.has(k)) {
        const val = structure[k as keyof T](undefined, `${path}.${k}`);
        if (val !== undefined) {
          r[k as keyof T] = val;
        }
      }
    }
    return r;
  };

export const record =
  <T,>(valueMapper: Mapper<T>): Mapper<Record<string, T>> =>
  (o, path = '') => {
    if (typeof o !== 'object') {
      throw new Error(`expected object, got ${typeof o} at ${path}`);
    }
    if (!o) {
      throw new Error(`expected object, got null at ${path}`);
    }
    if (Array.isArray(o)) {
      throw new Error(`expected object, got list at ${path}`);
    }
    const r = {} as Record<string, T>;
    for (const [k, v] of Object.entries(o)) {
      r[k] = valueMapper(v, `${path}.${k}`);
    }
    return r;
  };

export const list =
  <T,>(mapper: Mapper<T>): Mapper<T[]> =>
  (o, path = '') => {
    if (!Array.isArray(o)) {
      throw new Error(`expected list, got ${typeof o} at ${path}`);
    }
    return o.map((v, i) => mapper(v, `${path}[${i}]`));
  };

export const maybeList =
  <T,>(mapper: Mapper<T>): Mapper<T[]> =>
  (o, path = '') => {
    if (o === null || o === undefined) {
      return [];
    }
    if (!Array.isArray(o)) {
      return [mapper(o, path)];
    }
    return o.map((v, i) => mapper(v, `${path}[${i}]`));
  };

export const or =
  <M extends Mapper<any>[]>(...mappers: M): Mapper<Type<M[number]>> =>
  (o, path = '') => {
    const errors: unknown[] = [];
    for (const mapper of mappers) {
      try {
        return mapper(o, path);
      } catch (error: unknown) {
        errors.push(error);
      }
    }
    const filtered = errors.filter((e) => !(e instanceof ConstError));
    if (filtered.length === 1) {
      throw filtered[0];
    }
    throw new AggregateError(errors);
  };
