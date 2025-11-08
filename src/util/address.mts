import { isIPv4, isIPv6 } from 'node:net';

export interface Address {
  type: 'IPv4' | 'IPv6' | 'alias';
  ip: string;
  port: number | undefined;
}

export function parseAddress(address: string | undefined): Address | undefined {
  if (!address || address === 'unknown') {
    return undefined;
  }
  const ipv4 = /^((?:\d{1,3}\.){3}\d{1,3})(?::(\d+))?$/.exec(address);
  if (ipv4?.[1] && isIPv4(ipv4[1])) {
    return { type: 'IPv4', ip: ipv4[1], port: ipv4[2] ? Number.parseInt(ipv4[2]) : undefined };
  }
  const ipv6 = /^\[([\da-fA-F:]+)\](?::(\d+))?$|^([\da-fA-F:]+)$/.exec(address);
  if (ipv6?.[1] && isIPv6(ipv6[1])) {
    return {
      type: 'IPv6',
      ip: ipv6[1].toLowerCase(),
      port: ipv6[2] ? Number.parseInt(ipv6[2]) : undefined,
    };
  }
  if (ipv6?.[3] && isIPv6(ipv6[3])) {
    return { type: 'IPv6', ip: ipv6[3].toLowerCase(), port: undefined };
  }
  const alias = /^(.*?):(\d+)$/i.exec(address);
  if (alias?.[2]) {
    return { type: 'alias', ip: alias[1]!, port: Number.parseInt(alias[2]) };
  }
  return { type: 'alias', ip: address, port: undefined };
}

export function makeAddressTester(cidrRanges: string[]) {
  const aliases = new Set<string>();
  const ipv4: [number, number][] = [];
  const ipv6: [bigint, bigint][] = [];
  for (const range of cidrRanges) {
    const cidrv4 = /^((?:\d{1,3}\.){3}\d{1,3})(?:\/(\d+))?$/.exec(range);
    if (cidrv4?.[1]) {
      const shift = cidrv4[2] ? Number.parseInt(cidrv4[2]) : 32;
      const imask = shift < 32 ? 0xffffffff >>> shift : 0; // (x >>> 32) returns x, not 0
      ipv4.push([internalReadIPv4(cidrv4[1]) | imask, imask]);
      continue;
    }
    const cidrv6 = /^\[?([\da-fA-F:]+)\]?(?:\/(\d+))?$/.exec(range);
    if (cidrv6?.[1]) {
      const v = internalReadIPv6(cidrv6[1]);
      const imask = cidrv6[2] ? MAX_IPv6 >> BigInt(Number.parseInt(cidrv6[2])) : 0n;
      ipv6.push([v | imask, imask]);
      continue;
    }
    aliases.add(range);
  }
  return (address: Address | undefined) => {
    switch (address?.type) {
      case 'alias':
        return aliases.has(address.ip);
      case 'IPv4':
        const v4 = internalReadIPv4(address.ip);
        return ipv4.some(([base, imask]) => (v4 | imask) === base);
      case 'IPv6':
        const v6 = internalReadIPv6(address.ip);
        return ipv6.some(([base, imask]) => (v6 | imask) === base);
      default:
        return false;
    }
  };
}

const MAX_IPv6 = /*@__PURE__*/ BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');

function internalReadIPv4(ip: string) {
  const parts = ip.split('.').map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function internalReadIPv6(ip: string) {
  const parts = ip.split(':').map((v) => (v ? Number.parseInt(v, 16) : -1));
  let full = 0n;
  for (const part of parts) {
    if (part < 0) {
      full <<= 16n * BigInt(9 - parts.length);
    } else {
      full = (full << 16n) | BigInt(part);
    }
  }
  return full;
}
