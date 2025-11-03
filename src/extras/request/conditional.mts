import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Stats } from 'node:fs';
import { generateWeakETag } from '../cache/etag.mts';
import { readHTTPDateSeconds, getIfRange, readHTTPUnquotedCommaSeparated } from './headers.mts';

export function checkIfModified(
  req: IncomingMessage,
  res: ServerResponse,
  fileStats: Pick<Stats, 'mtimeMs' | 'size'>,
): boolean {
  const ifModifiedSince = readHTTPDateSeconds(req.headers['if-modified-since']);
  const ifNoneMatch = readHTTPUnquotedCommaSeparated(req.headers['if-none-match']);
  if (ifNoneMatch) {
    if (compareETag(res, fileStats, ifNoneMatch)) {
      return false;
    }
  } else if (ifModifiedSince && ((fileStats.mtimeMs / 1000) | 0) <= ifModifiedSince) {
    return false;
  }
  return true;
}

export function checkIfRange(
  req: IncomingMessage,
  res: ServerResponse,
  fileStats: Pick<Stats, 'mtimeMs' | 'size'>,
): boolean {
  let match = true;
  const ifRange = getIfRange(req);
  if (ifRange.etag) {
    match &&= compareETag(res, fileStats, ifRange.etag);
  }
  if (ifRange.modifiedSeconds) {
    match &&= ((fileStats.mtimeMs / 1000) | 0) === ifRange.modifiedSeconds;
  }
  return match;
}

export function compareETag(
  res: ServerResponse,
  stats: Pick<Stats, 'mtimeMs' | 'size'>,
  etags: string[],
) {
  if (etags.includes('*')) {
    return true;
  }
  const current = res.getHeader('etag');
  if (typeof current === 'string') {
    if (etags.includes(current)) {
      return true;
    }
    if (current.startsWith('W/"')) {
      return false;
    }
  }
  if (etags.some((etag) => etag.startsWith('W/"'))) {
    return etags.includes(generateWeakETag(res.getHeader('content-encoding'), stats));
  }
  return false;
}
