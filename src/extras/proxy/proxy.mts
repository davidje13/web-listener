import { Agent as httpAgent, request as httpRequest, type OutgoingHttpHeaders } from 'node:http';
import { Agent as httpsAgent, request as httpsRequest, type AgentOptions } from 'node:https';
import { pipeline } from 'node:stream/promises';
import { deleteProperty } from '../../util/safeAccess.mts';
import { internalIsPrematureCloseError } from '../../util/isPrematureCloseError.mts';
import { requestHandler } from '../../core/handler.mts';
import { getAbortSignal } from '../../core/close.mts';
import { HTTPError } from '../../core/HTTPError.mts';
import { acceptBody } from '../request/continue.mts';
import { STOP } from '../../core/RoutingInstruction.mts';
import { readHTTPUnquotedCommaSeparated } from '../request/headers.mts';
import type { ProxyRequestHeaderAdapter, ProxyResponseHeaderAdapter } from './headerAdapters.mts';

export interface ProxyOptions extends AgentOptions {
  agent?: httpAgent | httpsAgent | undefined;
  /**
   * A list of headers to remove from proxied requests (runs before `requestHeaders`).
   *
   * @default ['connection', 'expect', 'host', 'keep-alive', 'proxy-authorization', 'transfer-encoding', 'upgrade', 'via']
   */
  blockRequestHeaders?: string[] | undefined;
  /**
   * A list of headers to remove from proxied responses (runs before `responseHeaders`).
   *
   * @default ['connection', 'keep-alive', 'transfer-encoding']
   */
  blockResponseHeaders?: string[] | undefined;
  /**
   * Mutators for the proxied request headers. e.g. `replaceForwarded`.
   */
  requestHeaders?: ProxyRequestHeaderAdapter[] | undefined;
  /**
   * Mutators for the proxied response headers.
   */
  responseHeaders?: ProxyResponseHeaderAdapter[] | undefined;
}

export function proxy(
  forwardHost: string | URL,
  {
    blockRequestHeaders = [
      'connection',
      'expect',
      'host',
      'keep-alive',
      'proxy-authorization',
      'transfer-encoding',
      'upgrade',
      'via',
    ],
    requestHeaders = [],
    blockResponseHeaders = ['connection', 'keep-alive', 'transfer-encoding'],
    responseHeaders = [],
    agent,
    ...options
  }: ProxyOptions = {},
) {
  const forwardHostURL = new URL(forwardHost);
  let request: typeof httpRequest;
  if (forwardHostURL.protocol === 'https:') {
    agent ??= new httpsAgent({ keepAlive: true, ...options });
    request = httpRequest;
  } else {
    agent ??= new httpAgent({ keepAlive: true, ...options });
    request = httpsRequest;
  }
  // note: agent.destroy() is never called, because we do not know if/when the user is done with this proxy (even if detached it could be reattached)
  // - for cases where that is important, users should pass their own agent and manage it externally.

  const forwardPath = forwardHostURL.pathname;
  const forwardWithSlash = forwardPath + (forwardPath.endsWith('/') ? '' : '/');
  const forwardPrefix = 'a://a' + forwardWithSlash;

  return requestHandler(
    (req, res) =>
      new Promise((resolve, reject) => {
        if (res.closed || !res.writable) {
          return reject(STOP); // client closed connection; don't bother forwarding
        }

        const signal = getAbortSignal(req);
        const send502 = (error: unknown) =>
          reject(signal.aborted ? STOP : new HTTPError(502, { cause: error }));
        const proxyURL = new URL(forwardPrefix + req.url?.substring(1));
        if (!proxyURL.pathname.startsWith(forwardWithSlash) && proxyURL.pathname !== forwardPath) {
          return reject(new HTTPError(400, { message: 'directory traversal blocked' }));
        }

        acceptBody(req);

        let headers: OutgoingHttpHeaders = { ...req.headers };
        blockHeaders(headers, blockRequestHeaders);
        for (const adapter of requestHeaders) {
          headers = adapter(req, headers);
        }
        const proxyReq = request(forwardHostURL, {
          agent,
          path: proxyURL.pathname + proxyURL.search,
          method: req.method,
          headers,
          signal,
        });
        proxyReq.once('error', send502);
        proxyReq.once('response', (proxyRes) => {
          if (res.closed || !res.writable) {
            return reject(STOP); // client closed connection; don't bother streaming response
          }

          if (!res.headersSent) {
            let headers: OutgoingHttpHeaders = { ...proxyRes.headers };
            blockHeaders(headers, blockResponseHeaders);
            for (const adapter of responseHeaders) {
              headers = adapter(req, proxyRes, headers);
            }
            res.writeHead(proxyRes.statusCode ?? 200, proxyRes.statusMessage, headers);
          }

          pipeline(proxyRes, res).then(resolve, (error) =>
            reject(internalIsPrematureCloseError(res, error) ? STOP : error),
          );
        });

        pipeline(req, proxyReq).catch(send502);
      }),
  );
}

function blockHeaders(headers: OutgoingHttpHeaders, blocked: string[]) {
  for (const key of readHTTPUnquotedCommaSeparated(headers['connection']) ?? []) {
    deleteProperty(headers, key.toLowerCase());
  }
  for (const key of blocked) {
    deleteProperty(headers, key);
  }
}
