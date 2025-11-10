import { createServer } from 'node:net';

// Here we must return a port number which is likely to remain unused even
// though we stop listening on it for a moment, and ideally should not be
// re-used by subsequent tests (so that we can test that the server has
// shut down correctly, for example)

// Most tests simply use port 0, meaning they get a random port from an
// OS-defined range:
// - Old Linux:  1024- 4999
// - New Linux: 32768-60999 (cat /proc/sys/net/ipv4/ip_local_port_range)
// - macOS:     49152-65535 (sysctl net.inet.ip.portrange.first net.inet.ip.portrange.last)
// - Windows:   49152-65535 (https://learn.microsoft.com/en-us/troubleshoot/windows-server/networking/default-dynamic-port-range-tcpip-chang)

// So we pick a starting port far from these ranges, also avoiding
// common real-world fixed ports:
// https://en.wikipedia.org/wiki/List_of_TCP_and_UDP_port_numbers
// and sequentially search for unused ports:
let port = 13100;
const portMax = 30000;

// Each call is guaranteed to return a different port number

export async function findAvailablePort(): Promise<number> {
  const s = createServer();
  let res = (_: boolean) => {};
  let rej = (_: Error) => {};
  s.on('error', (error) => {
    if ('code' in error && error.code === 'EADDRINUSE') {
      res(false);
    } else {
      rej(error);
    }
  });
  s.on('listening', () => s.close(() => res(true)));

  while (port < portMax) {
    const portAttempt = port++;
    const success = await new Promise<boolean>((resolve, reject) => {
      res = resolve;
      rej = reject;
      s.listen(portAttempt, 'localhost');
    });
    if (success) {
      return portAttempt;
    }
  }
  throw new Error('Failed to find any available ports');
}
