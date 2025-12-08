import type { IncomingMessage, IncomingHttpHeaders } from 'node:http';
import {
  removeForwarded,
  replaceForwarded,
  sanitiseAndAppendForwarded,
  simpleAppendForwarded,
} from './headerAdapters.mts';
import 'lean-test';
import { makeGetClient } from '../request/getClient.mts';

describe('removeForwarded', () => {
  it('removes all forwarding headers', () => {
    const inputHeaders: IncomingHttpHeaders = {
      forwarded: 'gone',
      'x-forwarded-for': 'gone',
      'x-forwarded-host': 'gone',
      'x-forwarded-proto': 'gone',
      'x-forwarded-protocol': 'gone',
      'x-url-scheme': 'gone',
      other: 'remains',
    };
    const req = { headers: inputHeaders } as IncomingMessage;

    const outputHeaders = removeForwarded(req, { ...inputHeaders });

    expect(outputHeaders).equals({ other: 'remains' });
  });
});

describe('replaceForwarded', () => {
  it('removes non-standard forwarded headers and replaces forwarded', () => {
    const inputHeaders: IncomingHttpHeaders = {
      forwarded: 'for=9.9.9.9; by=1.2.3.4; host=example.com; proto=https',
      'x-forwarded-for': 'gone',
      'x-forwarded-host': 'gone',
      'x-forwarded-proto': 'gone',
      'x-forwarded-protocol': 'gone',
      'x-url-scheme': 'gone',
      host: 'next.example.com',
      other: 'remains',
    };
    const req = {
      headers: inputHeaders,
      socket: {
        remoteAddress: '1.2.3.4',
        remotePort: 1234,
        localAddress: '5.6.7.8',
        localPort: 5678,
      },
    } as IncomingMessage;

    const outputHeaders = replaceForwarded(req, { ...inputHeaders });

    expect(outputHeaders).equals({
      host: 'next.example.com',
      forwarded: 'for=1.2.3.4; by=5.6.7.8; host=next.example.com; proto=http',
      other: 'remains',
    });
  });
});

describe('simpleAppendForwarded', () => {
  it('removes non-standard forwarded headers and appends to forwarded', () => {
    const inputHeaders: IncomingHttpHeaders = {
      forwarded: 'for=9.9.9.9; by=1.2.3.4; host=example.com; proto=https, invalid',
      'x-forwarded-for': 'gone',
      'x-forwarded-host': 'gone',
      'x-forwarded-proto': 'gone',
      'x-forwarded-protocol': 'gone',
      'x-url-scheme': 'gone',
      host: 'next.example.com',
      other: 'remains',
    };
    const req = {
      headers: inputHeaders,
      socket: {
        remoteAddress: '1.2.3.4',
        remotePort: 1234,
        localAddress: '5.6.7.8',
        localPort: 5678,
      },
    } as IncomingMessage;

    const outputHeaders = simpleAppendForwarded(req, { ...inputHeaders });

    expect(outputHeaders).equals({
      host: 'next.example.com',
      forwarded:
        'for=9.9.9.9; by=1.2.3.4; host=example.com; proto=https, invalid, for=1.2.3.4; by=5.6.7.8; host=next.example.com; proto=http',
      other: 'remains',
    });
  });
});

describe('sanitiseAndAppendForwarded', () => {
  it('removes non-standard forwarded headers and updates forwarded', () => {
    const inputHeaders: IncomingHttpHeaders = {
      forwarded:
        'for=1.1.1.1; by=9.9.9.9; host=nope.example.com; custom=thing; proto=https, invalid, for=9.9.9.9; by=1.2.3.4; host=example.com; proto=https, for=1.2.3.4; by=5.5.5.5',
      'x-forwarded-for': 'gone',
      'x-forwarded-host': 'gone',
      'x-forwarded-proto': 'gone',
      'x-forwarded-protocol': 'gone',
      'x-url-scheme': 'gone',
      host: 'next.example.com',
      other: 'remains',
    };
    const req = {
      headers: inputHeaders,
      socket: {
        remoteAddress: '5.5.5.5',
        remotePort: 1234,
        localAddress: '5.6.7.8',
        localPort: 5678,
      },
    } as IncomingMessage;

    const outputHeaders = sanitiseAndAppendForwarded(
      makeGetClient({ trustedHeaders: ['forwarded'] }),
    )(req, { ...inputHeaders });

    expect(outputHeaders).equals({
      host: 'next.example.com',
      forwarded:
        'for=1.1.1.1; by=9.9.9.9; host=nope.example.com; proto=https, for=9.9.9.9; by=1.2.3.4; host=example.com; proto=https, for=1.2.3.4; by=5.5.5.5, for=5.5.5.5; by=5.6.7.8; host=next.example.com; proto=http',
      other: 'remains',
    });
  });

  it('only propagates trusted proxy information if onlyTrusted is true', () => {
    const inputHeaders: IncomingHttpHeaders = {
      forwarded:
        'for=1.1.1.1; by=9.9.9.9; host=nope.example.com; proto=https, for=9.9.9.9; by=1.2.3.4; host=example.com; proto=https, for=1.2.3.4; by=5.5.5.5',
      host: 'next.example.com',
    };
    const req = {
      headers: inputHeaders,
      socket: {
        remoteAddress: '5.5.5.5',
        remotePort: 1234,
        localAddress: '5.6.7.8',
        localPort: 5678,
      },
    } as IncomingMessage;

    const outputHeaders = sanitiseAndAppendForwarded(
      makeGetClient({
        trustedProxyAddresses: ['1.2.3.4', '5.5.5.5'],
        trustedHeaders: ['forwarded'],
      }),
      { onlyTrusted: true },
    )(req, { ...inputHeaders });

    expect(outputHeaders).equals({
      host: 'next.example.com',
      forwarded:
        'for=9.9.9.9; by=1.2.3.4; host=example.com; proto=https, for=1.2.3.4; by=5.5.5.5, for=5.5.5.5; by=5.6.7.8; host=next.example.com; proto=http',
    });
  });
});
