import { withServer } from '../../test-helpers/withServer.mts';
import { rawRequest } from '../../test-helpers/rawRequest.mts';
import { requestHandler } from '../../core/handler.mts';
import { Router } from '../../core/Router.mts';
import { staticContent, staticJSON } from './staticContent.mts';
import 'lean-test';

describe('staticContent', () => {
  const CONTENT = Buffer.from('this is my content');

  it('serves static content', { timeout: 3000 }, async () => {
    const handler = staticContent(CONTENT, 'text/plain; charset=utf-8');

    return withServer(handler, async (url) => {
      const res = await fetch(url);
      expect(res.status).equals(200);
      expect(res.headers.get('content-type')).equals('text/plain; charset=utf-8');
      expect(res.headers.get('etag')!).startsWith('\"');
      expect(res.headers.get('last-modified')).isNull();
      expect(await res.text()).equals('this is my content');

      const resHEAD = await fetch(url, { method: 'HEAD' });
      expect(resHEAD.status).equals(200);
      expect(resHEAD.headers.get('content-type')).equals('text/plain; charset=utf-8');
      expect(resHEAD.headers.get('etag')).equals(res.headers.get('etag'));
      expect(await resHEAD.text()).equals('');
    });
  });

  it('returns 304 Not Modified if the content is unchanged', { timeout: 3000 }, async () => {
    const handler = staticContent(CONTENT, 'text/plain; charset=utf-8');

    return withServer(handler, async (url) => {
      const res = await fetch(url);
      expect(res.status).equals(200);
      const etag = res.headers.get('etag')!;

      const resMatch = await fetch(url, { headers: { 'If-None-Match': etag } });
      expect(resMatch.status).equals(304);
      expect(await resMatch.text()).equals('');

      const resNonMatch = await fetch(url, { headers: { 'If-None-Match': '"other"' } });
      expect(resNonMatch.status).equals(200);
      expect(await resNonMatch.text()).equals('this is my content');
    });
  });

  it('sets custom headers', { timeout: 3000 }, async () => {
    const handler = staticContent(CONTENT, 'text/plain', { headers: { 'Cache-Control': 'foo' } });

    return withServer(handler, async (url) => {
      const res = await fetch(url);
      expect(res.status).equals(200);
      expect(res.headers.get('cache-control')).equals('foo');

      const resHEAD = await fetch(url, { method: 'HEAD' });
      expect(resHEAD.status).equals(200);
      expect(resHEAD.headers.get('cache-control')).equals('foo');
    });
  });

  it('supports content encoding negotiation', { timeout: 3000 }, async () => {
    const longContent = Buffer.from('a'.repeat(1000));
    const handler = staticContent(longContent, 'text/plain', { encodings: ['gzip'] });

    return withServer(handler, async (url) => {
      const res1 = await rawRequest(url);
      expect(res1).contains('a'.repeat(1000));
      expect(res1).contains('vary: accept-encoding');

      const res2 = await rawRequest(url, { headers: { 'accept-encoding': 'gzip' } });
      expect(res2).not(contains('a'.repeat(1000)));
      expect(res2).contains('content-encoding: gzip');
      expect(res2).contains('vary: accept-encoding');
    });
  });

  it('ignores content encoding if it is not worthwhile', { timeout: 3000 }, async () => {
    const longContent = Buffer.from('too short to compress well');
    const handler = staticContent(longContent, 'text/plain', {
      encodings: ['gzip'],
      minCompression: 10,
    });

    return withServer(handler, async (url) => {
      const res = await rawRequest(url, { headers: { 'accept-encoding': 'gzip' } });
      expect(res).contains('too short to compress well');
      expect(res).not(contains('content-encoding: gzip'));
      expect(res).not(contains('vary: accept-encoding'));
    });
  });

  it('ignores non-GET/HEAD requests', { timeout: 3000 }, async () => {
    const router = new Router();
    router.use(staticContent(CONTENT, 'text/plain'));
    router.use(requestHandler((req, res) => res.end(`fallback ${req.method}`)));

    return withServer(router, async (url) => {
      const res = await fetch(url, { method: 'POST' });
      expect(await res.text()).equals('fallback POST');
    });
  });
});

describe('staticJSON', () => {
  it('serves static JSON', { timeout: 3000 }, async () => {
    const handler = staticJSON({ foo: 'bar' });

    return withServer(handler, async (url) => {
      const res = await fetch(url);
      expect(res.status).equals(200);
      expect(res.headers.get('content-type')).equals('application/json');
      expect(await res.text()).equals('{"foo":"bar"}');
    });
  });
});
