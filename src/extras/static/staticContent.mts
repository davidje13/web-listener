import type { IncomingHttpHeaders } from 'node:http';
import { internalNormaliseHeaders, type AnyHeaders } from '../../util/normaliseHeaders.mts';
import type { RequestHandler } from '../../core/handler.mts';
import { CONTINUE } from '../../core/RoutingInstruction.mts';
import { checkIfModified } from '../request/conditional.mts';
import { generateStrongETagStatic } from '../cache/etag.mts';
import { compress, type ContentEncoding } from '../compress/encoders.mts';
import { Negotiator, type FileNegotiationOption } from '../request/Negotiator.mts';
import { internalAddVary, internalSetContentEncoding } from './setHeaders.mts';

export interface StaticContentOptions {
  headers?: AnyHeaders | undefined;
  encodings?: ContentEncoding[] | undefined;
  minCompression?: number;
}

export const staticContent = (
  content: Buffer,
  contentType: string,
  { headers, encodings = [], minCompression = 0 }: StaticContentOptions = {},
): RequestHandler => {
  const contentLookup = (async () => {
    const options = new Map<string, { _data: Buffer; _etag: string }>();
    options.set('', { _data: content, _etag: generateStrongETagStatic(content) });
    const negotiations: FileNegotiationOption[] = [];
    for (const encoding of encodings) {
      const compressed = await compress(content, encoding, minCompression);
      if (compressed) {
        options.set(encoding, {
          _data: compressed,
          _etag: generateStrongETagStatic(compressed),
        });
        negotiations.push({ value: encoding, file: encoding });
      }
    }
    const negotiator = new Negotiator([{ feature: 'encoding', options: negotiations }]);
    return (headers: IncomingHttpHeaders) => {
      for (const option of negotiator.options('', headers)) {
        const details = options.get(option.filename);
        if (details) {
          return { _headers: option.headers, ...details };
        }
      }
      throw new Error('failed to serve static content');
    };
  })();

  return {
    handleRequest: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return CONTINUE;
      }
      const { _headers, _etag, _data } = (await contentLookup)(req.headers);
      if (res.closed || !res.writable) {
        return; // client closed connection; don't bother replying
      }
      if (headers) {
        res.setHeaders(internalNormaliseHeaders(headers));
      }
      internalSetContentEncoding(res, _headers['content-encoding']);
      internalAddVary(res, _headers.vary);
      res.setHeader('content-type', contentType);
      res.setHeader('etag', _etag);

      if (!checkIfModified(req, res, null)) {
        res.writeHead(304).end();
      } else {
        res.setHeader('content-length', _data.byteLength);
        res.end(_data);
      }
      return;
    },
  };
};

export const staticJSON = (content: unknown, options?: StaticContentOptions) =>
  staticContent(Buffer.from(JSON.stringify(content), 'utf-8'), 'application/json', options);
