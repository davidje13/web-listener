import type { AddressInfo } from 'node:net';

export function getAddressURL(address: string | AddressInfo | null | undefined) {
  if (!address) {
    throw new Error('no address');
  }
  if (typeof address === 'string') {
    return address;
  }
  if (address.family === 'IPv4') {
    return `http://${address.address}:${address.port}`;
  } else if (address.family === 'IPv6') {
    return `http://[${address.address}]:${address.port}`;
  } else {
    throw new Error(`unknown address family: ${address.family}`);
  }
}
