/*
 * Adapted from busboy@1.6.0 by Brian White
 * https://github.com/mscdex/busboy/tree/9aadb7afbcb8c70c81c93b1018313c1b1835afb0
 */

import type { IncomingHttpHeaders } from 'node:http';
import { HTTPError } from '../../core/HTTPError.mts';
import { readHTTPInteger } from '../../extras/request/headers.mts';
import { parseContentType } from './utils.mts';
import type { BusboyOptions, StreamConsumer } from './types.mts';
import { getMultipartFormFields } from './multipart.mts';
import { getURLEncodedFormFields } from './urlencoded.mts';

export function busboy(headers: IncomingHttpHeaders, cfg: BusboyOptions = {}): StreamConsumer {
  const contentType = headers['content-type'];
  if (!contentType) {
    throw new HTTPError(400, { body: 'missing content-type' });
  }

  const conType = parseContentType(contentType);
  if (!conType) {
    throw new HTTPError(400, { body: 'malformed content-type' });
  }

  const contentLength = readHTTPInteger(headers['content-length']);
  if (
    contentLength !== undefined &&
    cfg.maxNetworkBytes !== undefined &&
    contentLength > cfg.maxNetworkBytes
  ) {
    throw new HTTPError(413, { body: 'content too large' });
  }

  if (conType.mime === 'application/x-www-form-urlencoded') {
    return getURLEncodedFormFields(cfg, conType.params);
  }

  if (conType.mime === 'multipart/form-data' && !cfg.blockMultipart) {
    return getMultipartFormFields(cfg, conType.params);
  }

  throw new HTTPError(415);
}
