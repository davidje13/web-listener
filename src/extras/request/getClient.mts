import type { IncomingMessage } from 'node:http';
import type { TLSSocket } from 'node:tls';
import { makeAddressTester, parseAddress, type Address } from '../../util/address.mts';
import { readHTTPUnquotedCommaSeparated, readHTTPKeyValues } from './headers.mts';
import { makeMemo } from '../Property.mts';

type ProxyHeader =
  | 'forwarded'
  | 'x-forwarded-for'
  | 'x-forwarded-host'
  | 'x-forwarded-proto'
  | 'x-forwarded-protocol'
  | 'x-url-scheme'
  | 'via';

export interface GetClientOptions {
  /**
   * The number of proxies to trust.
   *
   * Although `trustedProxyAddresses` makes it easier to guarantee security, specifying a count of
   * proxies is useful in cases where the IP of proxies is not known or can change.
   *
   * This should be set to the number of proxies in the chain for your deployment: 0 when exposed
   * directly to the internet, 1 when running behind a proxy, 2 when using a local reverse proxy as
   * well as a load balancer, etc.
   *
   * Note: you must make sure there is no way to access your server without going through at least
   * this many proxies, otherwise users will be able to spoof their client details, such as IP
   * address, requested hostname, and connection protocol.
   *
   * @default 0 if trustedProxyAddresses is not set
   * @default infinity if trustedProxyAddresses is set
   */
  trustedProxyCount?: number;

  /**
   * The proxies to trust.
   *
   * For maximum security this can be an array of IPv4 or IPv6 addresses (or CIDR ranges) of
   * trusted proxies. You can also specify alias names here, for cases where a proxy will be
   * labelled by an alias by the next proxy in the chain.
   *
   * @default none (trust all proxies within trustedProxyCount hops)
   */
  trustedProxyAddresses?: string[];

  /**
   * The headers which are set (or cleared) by your proxy, and can therefore be trusted.
   *
   * To use proxy data, you must explicitly configure these headers to match those set by your
   * proxy. Do not list headers which are not modified by your proxy, as this will allow clients
   * to spoof data.
   *
   * @default [] (no headers are trusted)
   */
  trustedHeaders: ProxyHeader[];
}

export type GetClient = (req: IncomingMessage) => ProxyChain;

export function makeGetClient({
  trustedProxyCount,
  trustedProxyAddresses,
  trustedHeaders,
}: GetClientOptions): GetClient {
  const trustAddress = trustedProxyAddresses
    ? makeAddressTester(trustedProxyAddresses)
    : () => true;
  const proxyMaxCount = trustedProxyCount ?? (trustedProxyAddresses ? Number.POSITIVE_INFINITY : 0);
  const trustedHeadersSet = new Set(trustedHeaders);

  return makeMemo((req) => {
    const get = (key: ProxyHeader) => {
      if (!trustedHeadersSet.has(key)) {
        return undefined;
      }
      // note: commas in quoted strings still separate the values. This is intentional, as it avoids a broken/malicious value "poisoning" all subsequent (more trusted) values
      return readHTTPUnquotedCommaSeparated(req.headers[key])?.reverse();
    };
    const forwarded = get('forwarded');
    const forwardedFor = get('x-forwarded-for');
    const forwardedHost = get('x-forwarded-host');
    const forwardedProto = get('x-forwarded-proto');
    const forwardedProtocol = get('x-forwarded-protocol');
    const urlScheme = get('x-url-scheme');
    const via = get('via')?.map((item) => {
      const match = /^([^/ ]+\/)?([^/ ]+) (.+)$/.exec(item);
      return match?.[3] ? parseAddress(match[3]) : undefined;
    });

    const fullOutwardChain = [internalGetDirectConnection(req)];

    if (forwarded) {
      // https://www.rfc-editor.org/rfc/rfc7239
      for (const item of forwarded) {
        try {
          const parts = readHTTPKeyValues(item);
          fullOutwardChain.push({
            client: parseAddress(parts.get('for')),
            server: parseAddress(parts.get('by')),
            host: parts.get('host'),
            proto: parts.get('proto'),
          });
        } catch {
          fullOutwardChain.push({
            client: undefined,
            server: undefined,
            host: undefined,
            proto: undefined,
          });
        }
      }
    } else if (forwardedFor) {
      const ips = forwardedFor.map(parseAddress);
      const hosts = forwardedHost ?? [];
      const protos = forwardedProto ?? forwardedProtocol ?? urlScheme ?? [];
      let prevClient = fullOutwardChain[0]!.client;
      for (let i = 0; i < ips.length; ++i) {
        const ip = ips[i];
        fullOutwardChain.push({
          client: ip,
          server: via?.[i] ?? (prevClient ? { ...prevClient, port: undefined } : undefined),
          host: hosts[i],
          proto: protos[i],
        });
        prevClient = ip;
      }
    } else if (via) {
      for (const ip of via) {
        fullOutwardChain.push({
          client: undefined, // note: we cannot get this from the previous entry, because it may be untrusted
          server: ip,
          host: undefined,
          proto: undefined,
        });
      }
    }

    let endOfTrust = Math.min(1 + proxyMaxCount, fullOutwardChain.length);
    for (let i = 0; i < endOfTrust - 1; ++i) {
      if (!trustAddress(fullOutwardChain[i]!.client)) {
        endOfTrust = i + 1;
      }
    }
    return Object.freeze({
      trusted: fullOutwardChain.slice(0, endOfTrust),
      untrusted: fullOutwardChain.slice(endOfTrust),
      outwardChain: fullOutwardChain,
      edge: fullOutwardChain[endOfTrust - 1]!,
    });
  });
}

export const internalGetDirectConnection = (req: IncomingMessage): ProxyNode => ({
  client: {
    ...(parseAddress(req.socket.remoteAddress) ?? DISCONNECTED),
    port: req.socket.remotePort,
  },
  server: {
    ...(parseAddress(req.socket.localAddress) ?? DISCONNECTED),
    port: req.socket.localPort,
  },
  host: req.headers.host,
  proto: (req.socket as TLSSocket).encrypted ? 'https' : 'http',
});

const DISCONNECTED: Address = {
  family: 'alias',
  address: '_disconnected',
  port: undefined,
};

export interface ProxyChain {
  trusted: ProxyNode[];
  untrusted: ProxyNode[];
  outwardChain: ProxyNode[];
  edge: ProxyNode;
}

export interface ProxyNode {
  client: Address | undefined;
  server: Address | undefined;
  host: string | undefined;
  proto: string | undefined;
}
