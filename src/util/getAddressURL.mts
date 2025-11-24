import type { AddressInfo } from 'node:net';
import type { Address } from './address.mts';

export function getAddressURL(
  addressInfo: string | Address | AddressInfo | null | undefined,
  protocol = 'http',
) {
  if (!addressInfo) {
    throw new TypeError('no address');
  }
  if (typeof addressInfo === 'string') {
    return addressInfo;
  }
  const port = addressInfo.port === undefined ? '' : `:${addressInfo.port}`;
  if (addressInfo.family === 'IPv4' || addressInfo.family === 'alias') {
    return `${protocol}://${addressInfo.address}${port}`;
  } else if (addressInfo.family === 'IPv6') {
    return `${protocol}://[${addressInfo.address}]${port}`;
  } else {
    throw new TypeError(`unknown address family: ${addressInfo.family}`);
  }
}
