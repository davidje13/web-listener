import {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
} from 'node:http';
import { internalGetDirectConnection, type ProxyNode } from '../request/getClient.mts';

export type ProxyRequestHeaderAdapter = (
  request: IncomingMessage,
  headers: OutgoingHttpHeaders,
) => OutgoingHttpHeaders;

export type ProxyResponseHeaderAdapter = (
  request: IncomingMessage,
  proxyResponse: IncomingMessage,
  headers: OutgoingHttpHeaders,
) => OutgoingHttpHeaders;

export function removeForwarded(
  _: IncomingMessage,
  headers: IncomingHttpHeaders,
): OutgoingHttpHeaders {
  delete headers['forwarded'];
  delete headers['x-forwarded-for'];
  delete headers['x-forwarded-host'];
  delete headers['x-forwarded-proto'];
  delete headers['x-forwarded-protocol'];
  delete headers['x-url-scheme'];
  return headers;
}

export function replaceForwarded(
  req: IncomingMessage,
  headers: IncomingHttpHeaders,
): OutgoingHttpHeaders {
  const outHeaders = removeForwarded(req, headers);
  outHeaders['forwarded'] = writeForwarded([internalGetDirectConnection(req)]);
  return outHeaders;
}

export const sanitiseAndAppendForwarded =
  (
    getClient: (req: IncomingMessage) => { outwardChain: ProxyNode[]; trusted: ProxyNode[] },
    { onlyTrusted = false } = {},
  ) =>
  (req: IncomingMessage, headers: IncomingHttpHeaders): OutgoingHttpHeaders => {
    const outHeaders = removeForwarded(req, headers);
    const client = getClient(req);
    outHeaders['forwarded'] = writeForwarded(
      [...(onlyTrusted ? client.trusted : client.outwardChain)].reverse(),
    );
    return outHeaders;
  };

export function simpleAppendForwarded(
  req: IncomingMessage,
  headers: IncomingHttpHeaders,
): OutgoingHttpHeaders {
  let forwarded = req.headers.forwarded;
  const newForwarded = writeForwarded([internalGetDirectConnection(req)]);
  if (forwarded) {
    forwarded += ', ' + newForwarded;
  } else {
    forwarded = newForwarded;
  }
  const outHeaders = removeForwarded(req, headers);
  outHeaders['forwarded'] = forwarded;
  return outHeaders;
}

export function writeForwarded(forwarded: ProxyNode[]) {
  return forwarded
    .filter((node) => node.server || node.client)
    .map((node) =>
      Object.entries({
        for: node.client?.address,
        by: node.server?.address,
        host: node.host,
        proto: node.proto,
      })
        .filter(([_, v]) => v)
        .map(([k, v]) =>
          v && /[^a-zA-Z0-9._]/.test(v)
            ? `${k}="${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll(',', '-')}"`
            : `${k}=${v}`,
        )
        .join('; '),
    )
    .join(', ');
}
