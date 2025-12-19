import { withServer } from '../../test-helpers/withServer.mts';
import { rawRequest } from '../../test-helpers/rawRequest.mts';
import { requestHandler, upgradeHandler } from '../../core/handler.mts';
import { acceptBody, willSendBody } from './continue.mts';
import 'lean-test';

describe('acceptBody', () => {
  it('sends 100 Continue if request included expect: continue', { timeout: 3000 }, () => {
    const handler = requestHandler((req, res) => {
      acceptBody(req);
      res.end('handler content');
    });

    return withServer(handler, async (url) => {
      const response = await rawRequest(url, {
        method: 'POST',
        headers: { expect: '100-Continue' },
      });
      expect(response).contains('100 Continue');
      expect(response).contains('handler content');
    });
  });

  it('does not send 100 Continue if unnecessary', { timeout: 3000 }, () => {
    const handler = requestHandler((req, res) => {
      acceptBody(req);
      res.end('handler content');
    });

    return withServer(handler, async (url) => {
      const response1 = await rawRequest(url, {
        method: 'POST',
        headers: { expect: 'another thing' },
      });
      expect(response1).not(contains('100 Continue'));
      expect(response1).contains('handler content');

      const response2 = await rawRequest(url, { method: 'POST' });
      expect(response2).not(contains('100 Continue'));
      expect(response2).contains('handler content');
    });
  });

  it('only sends 100 Continue once', { timeout: 3000 }, () => {
    const handler = requestHandler((req, res) => {
      acceptBody(req);
      acceptBody(req);
      res.end('handler content');
    });

    return withServer(handler, async (url) => {
      const response = await rawRequest(url, {
        method: 'POST',
        headers: { expect: '100-Continue' },
      });
      const occurrences = [...response.matchAll(/100 Continue/g)];
      expect(occurrences).hasLength(1);
      expect(response).contains('handler content');
    });
  });

  it('does not send 100 Continue when handling upgrades', { timeout: 3000 }, () => {
    const handler = upgradeHandler((req, res) => {
      acceptBody(req);
      res.end('raw content');
    });

    return withServer(handler, async (url) => {
      const response = await rawRequest(url, {
        method: 'POST',
        headers: { connection: 'upgrade', upgrade: 'foo', expect: '100-Continue' },
      });
      expect(response).not(contains('100 Continue'));
      expect(response).contains('raw content');
    });
  });
});

describe('willSendBody', () => {
  it('returns true if acceptBody has been called', { timeout: 3000 }, () => {
    let captured: unknown = undefined;
    const handler = requestHandler((req, res) => {
      acceptBody(req);
      captured = willSendBody(req);
      res.end('handler content');
    });

    return withServer(handler, async (url) => {
      await rawRequest(url, { method: 'POST', headers: { expect: '100-Continue' } });
      expect(captured).equals(true);
    });
  });

  it('returns true if Expect: 100-Continue was not sent', { timeout: 3000 }, () => {
    let captured: unknown = undefined;
    const handler = requestHandler((req, res) => {
      captured = willSendBody(req);
      res.end('handler content');
    });

    return withServer(handler, async (url) => {
      await rawRequest(url, { method: 'POST' });
      expect(captured).equals(true);
    });
  });

  it(
    'returns false if Expect: 100-Continue was sent and acceptBody has not been called',
    { timeout: 3000 },
    () => {
      let captured: unknown = undefined;
      const handler = requestHandler((req, res) => {
        captured = willSendBody(req);
        res.end('handler content');
      });

      return withServer(handler, async (url) => {
        await rawRequest(url, { method: 'POST', headers: { expect: '100-Continue' } });
        expect(captured).equals(false);
      });
    },
  );
});
