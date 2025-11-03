import { IncomingMessage } from 'node:http';
import { internalParseURL } from './parseURL.mts';
import 'lean-test';

describe('parseURL', () => {
  it('parses pathnames from IncomingMessage', () => {
    const req = { url: '/foo/bar?q1=a' } as IncomingMessage;
    const url = internalParseURL(req);
    expect(url.pathname).equals('/foo/bar');
    expect(url.search).equals('?q1=a');
    expect(url.searchParams.get('q1')).equals('a');
  });

  it('handles missing urls', () => {
    const req = { url: undefined } as IncomingMessage;
    const url = internalParseURL(req);
    expect(url.pathname).equals('/');
    expect(url.search).equals('');
    expect(url.searchParams).hasLength(0);
  });
});
