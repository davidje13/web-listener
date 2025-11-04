import type { AddressInfo } from 'node:net';

export function getAddressURL(address: string | AddressInfo | null | undefined, protocol = 'http') {
  if (!address) {
    throw new Error('no address');
  }
  if (typeof address === 'string') {
    return address;
  }
  if (address.family === 'IPv4') {
    return `${protocol}://${address.address}:${address.port}`;
  } else if (address.family === 'IPv6') {
    return `${protocol}://[${address.address}]:${address.port}`;
  } else {
    throw new Error(`unknown address family: ${address.family}`);
  }
}
