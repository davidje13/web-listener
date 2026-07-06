import type { OutgoingHttpHeaders } from 'node:http';
import { internalNormaliseHeaderValue } from '../polyfill/SocketServerResponse.mts';

export type LooseHeaderValue = string | number | ReadonlyArray<string>;

export type AnyHeaders =
  | Headers
  | ReadonlyArray<[string, string]>
  | OutgoingHttpHeaders
  | Map<string, LooseHeaderValue>
  | undefined;

export function internalNormaliseHeaders(headers: AnyHeaders): Headers {
  if (!headers || headers instanceof Headers || Array.isArray(headers)) {
    return new Headers(headers);
  }
  const entries = headers instanceof Map ? [...headers.entries()] : Object.entries(headers);
  return new Headers(
    entries
      .map(([k, v]): [string, string] => [k, internalNormaliseHeaderValue(v)])
      .filter(([_, v]) => v),
  );
}
