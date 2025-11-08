/*
 * Adapted from busboy@1.6.0 by Brian White
 * https://github.com/mscdex/busboy/tree/9aadb7afbcb8c70c81c93b1018313c1b1835afb0
 */

import type { IncomingHttpHeaders } from 'node:http';
import { HTTPError } from '../../core/HTTPError.mts';
import { parseContentType } from './utils.mts';
import type { BusboyInstance, BusboyOptions } from './types.mts';
import { Multipart } from './multipart.mts';
import { URLEncoded } from './urlencoded.mts';

export function busboy(headers: IncomingHttpHeaders, cfg: BusboyOptions = {}): BusboyInstance {
  const contentType = headers['content-type'];
  if (!contentType) {
    throw new HTTPError(400, { body: 'Missing Content-Type' });
  }

  const conType = parseContentType(contentType);
  if (!conType) {
    throw new HTTPError(400, { body: 'Malformed content type' });
  }

  const type =
    conType.mime === 'application/x-www-form-urlencoded'
      ? URLEncoded
      : conType.mime === 'multipart/form-data' && !cfg.blockMultipart
        ? Multipart
        : null;

  if (!type) {
    throw new HTTPError(415);
  }

  return new type(cfg, conType.params) as unknown as BusboyInstance;
}
