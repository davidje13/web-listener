import type { IncomingMessage, IncomingHttpHeaders } from 'node:http';
import { inRequestHandler } from '../../test-helpers/withServer.mts';
import { internalGetDirectConnection, makeGetClient } from './getClient.mts';
import 'lean-test';

describe('getDirectConnection', () => {
  it('returns details about the direct connection ignoring proxy information', () => {
    const req = {
      headers: {
        forwarded: 'for=1.1.1.1; by=9.9.9.9; host=nope.example.com',
        host: 'this.example.com',
      },
      socket: {
        remoteAddress: '5.5.5.5',
        remotePort: 1234,
        localAddress: '5.6.7.8',
        localPort: 5678,
      },
    } as IncomingMessage;

    const node = internalGetDirectConnection(req);

    expect(node).equals({
      client: { family: 'IPv4', address: '5.5.5.5', port: 1234 },
      server: { family: 'IPv4', address: '5.6.7.8', port: 5678 },
      host: 'this.example.com',
      proto: 'http',
    });
  });

  it('returns https for the protocol if the server is a https.Server', { timeout: 3000 }, () =>
    inRequestHandler(
      async (req) => {
        const node = internalGetDirectConnection(req);
        expect(node.proto).equals('https');
      },
      {},
      { tls: true },
    ),
  );
});

describe('makeGetClient', () => {
  const TEST_FORWARDED =
    'for=1.1.1.1; by=9.9.9.9; extra=thing; host=original.example.com; proto=https, for=9.9.9.9; by=1.2.3.4; host=example.com; proto=http, for=1.2.3.4; by=5.5.5.5';

  const TEST_SOCKET = {
    remoteAddress: '5.5.5.5',
    remotePort: 1234,
    localAddress: '5.6.7.8',
    localPort: 5678,
  };

  const TEST_CHAIN = [
    {
      client: { family: 'IPv4', address: '5.5.5.5', port: 1234 },
      server: { family: 'IPv4', address: '5.6.7.8', port: 5678 },
      host: 'this.example.com',
      proto: 'http',
    },
    {
      client: { family: 'IPv4', address: '1.2.3.4', port: undefined },
      server: { family: 'IPv4', address: '5.5.5.5', port: undefined },
      host: undefined,
      proto: undefined,
    },
    {
      client: { family: 'IPv4', address: '9.9.9.9', port: undefined },
      server: { family: 'IPv4', address: '1.2.3.4', port: undefined },
      host: 'example.com',
      proto: 'http',
    },
    {
      client: { family: 'IPv4', address: '1.1.1.1', port: undefined },
      server: { family: 'IPv4', address: '9.9.9.9', port: undefined },
      host: 'original.example.com',
      proto: 'https',
    },
  ];

  it('returns a function which extracts proxy information from the forwarded header', () => {
    const getClient = makeGetClient({ trustedHeaders: ['forwarded'] });

    const req = {
      headers: { forwarded: TEST_FORWARDED, host: 'this.example.com' },
      socket: TEST_SOCKET,
    } as IncomingMessage;

    const client = getClient(req);
    expect(client.outwardChain).equals(TEST_CHAIN);
  });

  it('extracts proxy information from x-forwarded-for if configured', () => {
    const getClient = makeGetClient({ trustedHeaders: ['x-forwarded-for'] });

    const req = {
      headers: {
        'x-forwarded-for': '1.1.1.1, 9.9.9.9, 1.2.3.4',
        'x-forwarded-host': 'original.example.com, example.com, example.com',
        'x-forwarded-proto': 'https, https, http',
        host: 'this.example.com',
      } as IncomingHttpHeaders,
      socket: TEST_SOCKET,
    } as IncomingMessage;

    const client = getClient(req);
    expect(client.outwardChain).equals([
      {
        client: { family: 'IPv4', address: '5.5.5.5', port: 1234 },
        server: { family: 'IPv4', address: '5.6.7.8', port: 5678 },
        host: 'this.example.com',
        proto: 'http',
      },
      {
        client: { family: 'IPv4', address: '1.2.3.4', port: undefined },
        server: { family: 'IPv4', address: '5.5.5.5', port: undefined },
        host: undefined,
        proto: undefined,
      },
      {
        client: { family: 'IPv4', address: '9.9.9.9', port: undefined },
        server: { family: 'IPv4', address: '1.2.3.4', port: undefined },
        host: undefined,
        proto: undefined,
      },
      {
        client: { family: 'IPv4', address: '1.1.1.1', port: undefined },
        server: { family: 'IPv4', address: '9.9.9.9', port: undefined },
        host: undefined,
        proto: undefined,
      },
    ]);
  });

  it('combines x-forwarded-for with x-forwarded-host if configured', () => {
    const getClient = makeGetClient({ trustedHeaders: ['x-forwarded-for', 'x-forwarded-host'] });

    const req = {
      headers: {
        'x-forwarded-for': '1.1.1.1, 9.9.9.9, 1.2.3.4',
        'x-forwarded-host': 'original.example.com, foo.example.com, bar.example.com',
        'x-forwarded-proto': 'https, https, http',
        host: 'this.example.com',
      } as IncomingHttpHeaders,
      socket: TEST_SOCKET,
    } as IncomingMessage;

    const client = getClient(req);
    expect(client.outwardChain).equals([
      {
        client: { family: 'IPv4', address: '5.5.5.5', port: 1234 },
        server: { family: 'IPv4', address: '5.6.7.8', port: 5678 },
        host: 'this.example.com',
        proto: 'http',
      },
      {
        client: { family: 'IPv4', address: '1.2.3.4', port: undefined },
        server: { family: 'IPv4', address: '5.5.5.5', port: undefined },
        host: 'bar.example.com',
        proto: undefined,
      },
      {
        client: { family: 'IPv4', address: '9.9.9.9', port: undefined },
        server: { family: 'IPv4', address: '1.2.3.4', port: undefined },
        host: 'foo.example.com',
        proto: undefined,
      },
      {
        client: { family: 'IPv4', address: '1.1.1.1', port: undefined },
        server: { family: 'IPv4', address: '9.9.9.9', port: undefined },
        host: 'original.example.com',
        proto: undefined,
      },
    ]);
  });

  it('combines x-forwarded-for with x-forwarded-proto if configured', () => {
    const getClient = makeGetClient({ trustedHeaders: ['x-forwarded-for', 'x-forwarded-proto'] });

    const req = {
      headers: {
        'x-forwarded-for': '1.1.1.1, 9.9.9.9, 1.2.3.4',
        'x-forwarded-host': 'original.example.com, foo.example.com, bar.example.com',
        'x-forwarded-proto': 'https, https, http',
        host: 'this.example.com',
      } as IncomingHttpHeaders,
      socket: TEST_SOCKET,
    } as IncomingMessage;

    const client = getClient(req);
    expect(client.outwardChain).equals([
      {
        client: { family: 'IPv4', address: '5.5.5.5', port: 1234 },
        server: { family: 'IPv4', address: '5.6.7.8', port: 5678 },
        host: 'this.example.com',
        proto: 'http',
      },
      {
        client: { family: 'IPv4', address: '1.2.3.4', port: undefined },
        server: { family: 'IPv4', address: '5.5.5.5', port: undefined },
        host: undefined,
        proto: 'http',
      },
      {
        client: { family: 'IPv4', address: '9.9.9.9', port: undefined },
        server: { family: 'IPv4', address: '1.2.3.4', port: undefined },
        host: undefined,
        proto: 'https',
      },
      {
        client: { family: 'IPv4', address: '1.1.1.1', port: undefined },
        server: { family: 'IPv4', address: '9.9.9.9', port: undefined },
        host: undefined,
        proto: 'https',
      },
    ]);
  });

  it('extracts proxy information from via if configured', () => {
    const getClient = makeGetClient({ trustedHeaders: ['via'] });

    const req = {
      headers: {
        via: '1.1 9.9.9.9, 1.1 1.2.3.4:80, HTTP/1.1 5.5.5.5',
        host: 'this.example.com',
      },
      socket: TEST_SOCKET,
    } as IncomingMessage;

    const client = getClient(req);
    expect(client.outwardChain).equals([
      {
        client: { family: 'IPv4', address: '5.5.5.5', port: 1234 },
        server: { family: 'IPv4', address: '5.6.7.8', port: 5678 },
        host: 'this.example.com',
        proto: 'http',
      },
      {
        client: undefined,
        server: { family: 'IPv4', address: '5.5.5.5', port: undefined },
        host: undefined,
        proto: undefined,
      },
      {
        client: undefined,
        server: { family: 'IPv4', address: '1.2.3.4', port: 80 },
        host: undefined,
        proto: undefined,
      },
      {
        client: undefined,
        server: { family: 'IPv4', address: '9.9.9.9', port: undefined },
        host: undefined,
        proto: undefined,
      },
    ]);
  });

  it('combines x-forwarded-for with via if configured', () => {
    const getClient = makeGetClient({ trustedHeaders: ['x-forwarded-for', 'via'] });

    const req = {
      headers: {
        'x-forwarded-for': '1.1.1.1, 9.9.9.9, 1.2.3.4',
        via: '1.1 9.9.9.9:123, HTTP/1.1 1.2.3.4:456, 1.1 5.5.5.5:789',
        host: 'this.example.com',
      } as IncomingHttpHeaders,
      socket: TEST_SOCKET,
    } as IncomingMessage;

    const client = getClient(req);
    expect(client.outwardChain).equals([
      {
        client: { family: 'IPv4', address: '5.5.5.5', port: 1234 },
        server: { family: 'IPv4', address: '5.6.7.8', port: 5678 },
        host: 'this.example.com',
        proto: 'http',
      },
      {
        client: { family: 'IPv4', address: '1.2.3.4', port: undefined },
        server: { family: 'IPv4', address: '5.5.5.5', port: 789 },
        host: undefined,
        proto: undefined,
      },
      {
        client: { family: 'IPv4', address: '9.9.9.9', port: undefined },
        server: { family: 'IPv4', address: '1.2.3.4', port: 456 },
        host: undefined,
        proto: undefined,
      },
      {
        client: { family: 'IPv4', address: '1.1.1.1', port: undefined },
        server: { family: 'IPv4', address: '9.9.9.9', port: 123 },
        host: undefined,
        proto: undefined,
      },
    ]);
  });

  it('assumes x-forwarded-host and x-forwarded-proto apply to the nearest hops', () => {
    const getClient = makeGetClient({
      trustedHeaders: ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'],
    });

    const req = {
      headers: {
        'x-forwarded-for': '1.1.1.1, 9.9.9.9, 1.2.3.4',
        'x-forwarded-host': 'foo.example.com, bar.example.com',
        'x-forwarded-proto': 'https, http',
        host: 'this.example.com',
      } as IncomingHttpHeaders,
      socket: TEST_SOCKET,
    } as IncomingMessage;

    const client = getClient(req);
    expect(client.outwardChain).equals([
      {
        client: { family: 'IPv4', address: '5.5.5.5', port: 1234 },
        server: { family: 'IPv4', address: '5.6.7.8', port: 5678 },
        host: 'this.example.com',
        proto: 'http',
      },
      {
        client: { family: 'IPv4', address: '1.2.3.4', port: undefined },
        server: { family: 'IPv4', address: '5.5.5.5', port: undefined },
        host: 'bar.example.com',
        proto: 'http',
      },
      {
        client: { family: 'IPv4', address: '9.9.9.9', port: undefined },
        server: { family: 'IPv4', address: '1.2.3.4', port: undefined },
        host: 'foo.example.com',
        proto: 'https',
      },
      {
        client: { family: 'IPv4', address: '1.1.1.1', port: undefined },
        server: { family: 'IPv4', address: '9.9.9.9', port: undefined },
        host: undefined,
        proto: undefined,
      },
    ]);
  });

  it('trusts no proxies by default', () => {
    const getClient = makeGetClient({ trustedHeaders: ['forwarded'] });

    const req = {
      headers: { forwarded: TEST_FORWARDED, host: 'this.example.com' },
      socket: TEST_SOCKET,
    } as IncomingMessage;

    const client = getClient(req);
    expect(client.trusted).equals(TEST_CHAIN.slice(0, 1));
    expect(client.untrusted).equals(TEST_CHAIN.slice(1));
    expect(client.edge).equals(TEST_CHAIN[0]);
  });

  it('trusts proxies by IP', () => {
    const getClient = makeGetClient({
      trustedHeaders: ['forwarded'],
      trustedProxyAddresses: ['5.5.5.5'],
    });

    const req = {
      headers: { forwarded: TEST_FORWARDED, host: 'this.example.com' },
      socket: TEST_SOCKET,
    } as IncomingMessage;

    const client = getClient(req);
    expect(client.trusted).equals(TEST_CHAIN.slice(0, 2));
    expect(client.untrusted).equals(TEST_CHAIN.slice(2));
    expect(client.edge).equals(TEST_CHAIN[1]);
  });

  it('trusts proxies by hop count', () => {
    const getClient = makeGetClient({
      trustedHeaders: ['forwarded'],
      trustedProxyCount: 2,
    });

    const req = {
      headers: { forwarded: TEST_FORWARDED, host: 'this.example.com' },
      socket: TEST_SOCKET,
    } as IncomingMessage;

    const client = getClient(req);
    expect(client.trusted).equals(TEST_CHAIN.slice(0, 3));
    expect(client.untrusted).equals(TEST_CHAIN.slice(3));
    expect(client.edge).equals(TEST_CHAIN[2]);
  });

  it('does not trust any information after an untrusted proxy', () => {
    const getClient = makeGetClient({
      trustedHeaders: ['forwarded'],
      trustedProxyAddresses: ['1.2.3.4'],
    });

    const req = {
      headers: { forwarded: TEST_FORWARDED, host: 'this.example.com' },
      socket: TEST_SOCKET,
    } as IncomingMessage;

    const client = getClient(req);
    expect(client.trusted).equals(TEST_CHAIN.slice(0, 1));
    expect(client.untrusted).equals(TEST_CHAIN.slice(1));
    expect(client.edge).equals(TEST_CHAIN[0]);
  });
});
