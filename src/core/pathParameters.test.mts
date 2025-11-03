import { withServer } from '../test-helpers/withServer.mts';
import { rawRequest } from '../test-helpers/rawRequest.mts';
import { responds } from '../test-helpers/responds.mts';
import { Router } from './Router.mts';
import { requestHandler } from './handler.mts';
import {
  getAbsolutePath,
  getPathParameter,
  getPathParameters,
  restoreAbsolutePath,
} from './pathParameters.mts';
import 'lean-test';

describe('getPathParameters', () => {
  it('returns path components found in the current route', { timeout: 3000 }, () => {
    let capturedParameters: unknown;
    const router = new Router().get('/things/:id/actions/:act', (req, res) => {
      capturedParameters = getPathParameters(req);
      res.end();
    });

    return withServer(router, async (url) => {
      await expect(fetch(url + '/things/1/actions/dothing'), responds());
      expect(capturedParameters).equals({ id: '1', act: 'dothing' });

      await expect(fetch(url + '/things/2/actions/other'), responds());
      expect(capturedParameters).equals({ id: '2', act: 'other' });
    });
  });

  it('applies to upgrade requests', { timeout: 3000 }, () => {
    let capturedParameters: unknown;
    const router = new Router().onUpgrade(
      'GET',
      'thing',
      '/things/:id/actions/:act',
      (req, socket) => {
        capturedParameters = getPathParameters(req);
        socket.end();
      },
    );

    return withServer(router, async (url) => {
      await rawRequest(url + '/things/1/actions/dothing', {
        headers: { connection: 'upgrade', upgrade: 'thing' },
      });
      expect(capturedParameters).equals({ id: '1', act: 'dothing' });
    });
  });

  it('returns a list for wildcard paths', { timeout: 3000 }, () => {
    let capturedParameters: unknown;
    const router = new Router()
      .get('/things/*sub/dothing', (req, res) => {
        capturedParameters = getPathParameters(req);
        res.end();
      })
      .get('/other/*trailing', (req, res) => {
        capturedParameters = getPathParameters(req);
        res.end();
      });

    return withServer(router, async (url) => {
      await expect(fetch(url + '/things/1/actions/dothing'), responds());
      expect(capturedParameters).equals({ sub: ['1', 'actions'] });

      await expect(fetch(url + '/things/justone/dothing'), responds());
      expect(capturedParameters).equals({ sub: ['justone'] });

      await expect(fetch(url + '/things///justone///dothing'), responds());
      expect(capturedParameters).equals({ sub: ['justone'] });

      await expect(fetch(url + '/other/blah/'), responds());
      expect(capturedParameters).equals({ trailing: ['blah'] });

      await expect(fetch(url + '/other/blah'), responds());
      expect(capturedParameters).equals({ trailing: ['blah'] });

      await expect(fetch(url + '/other/'), responds());
      expect(capturedParameters).equals({ trailing: [] });

      await expect(fetch(url + '/other///'), responds());
      expect(capturedParameters).equals({ trailing: [] });

      await expect(fetch(url + '/other/foo///bar'), responds());
      expect(capturedParameters).equals({ trailing: ['foo', 'bar'] });
    });
  });

  it('preserves all slashes when mergeSlashes is off', { timeout: 3000 }, () => {
    let capturedParameters: unknown;
    const router = new Router().get('!/foo/*trailing', (req, res) => {
      capturedParameters = getPathParameters(req);
      res.end();
    });

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo/blah'), responds());
      expect(capturedParameters).equals({ trailing: ['blah'] });

      await expect(fetch(url + '/foo/blah/'), responds());
      expect(capturedParameters).equals({ trailing: ['blah', ''] });

      await expect(fetch(url + '/foo//one//two'), responds());
      expect(capturedParameters).equals({ trailing: ['', 'one', '', 'two'] });

      await expect(fetch(url + '/foo////'), responds());
      expect(capturedParameters).equals({ trailing: ['', '', '', ''] });
    });
  });

  it('returns undefined for missing optional components', { timeout: 3000 }, () => {
    let capturedParameters: unknown;
    const router = new Router()
      .get('/one{/:maybe}', (req, res) => {
        capturedParameters = getPathParameters(req);
        res.end();
      })
      .get('/many{/*maybe}', (req, res) => {
        capturedParameters = getPathParameters(req);
        res.end();
      });

    return withServer(router, async (url) => {
      await expect(fetch(url + '/one/yep'), responds());
      expect(capturedParameters).equals({ maybe: 'yep' });

      await expect(fetch(url + '/one'), responds());
      expect(capturedParameters).equals({ maybe: undefined });

      await expect(fetch(url + '/many/yep'), responds());
      expect(capturedParameters).equals({ maybe: ['yep'] });

      await expect(fetch(url + '/many/'), responds());
      expect(capturedParameters).equals({ maybe: [] });

      await expect(fetch(url + '/many'), responds());
      expect(capturedParameters).equals({ maybe: undefined });
    });
  });

  it('applies URL decoding', { timeout: 3000 }, () => {
    let capturedParameters: unknown;
    const router = new Router().get('/foo/:id/*rest', (req, res) => {
      capturedParameters = getPathParameters(req);
      res.end();
    });

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo/%25stuff/path%20bits'), responds());
      expect(capturedParameters).equals({ id: '%stuff', rest: ['path bits'] });
    });
  });

  // TODO
  it.ignore('allows URL encoded slashes in path parameters', { timeout: 3000 }, () => {
    let capturedParameters: unknown;
    const router = new Router().get('/foo/:id/*rest', (req, res) => {
      capturedParameters = getPathParameters(req);
      res.end();
    });

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo/a%2fb/one%2f1/two%2f2'), responds());
      expect(capturedParameters).equals({ id: 'a/b', rest: ['one/1', 'two/2'] });
    });
  });
});

describe('getPathParameter', () => {
  it('returns a single path parameter by ID', () => {
    let capturedParameter: unknown;
    const router = new Router().get('/things/:id/actions/:act', (req, res) => {
      capturedParameter = getPathParameter(req, 'act');
      res.end();
    });

    return withServer(router, async (url) => {
      await expect(fetch(url + '/things/1/actions/dothing'), responds());
      expect(capturedParameter).equals('dothing');
    });
  });
});

describe('getAbsolutePath', () => {
  it('returns the original path of the request', () => {
    let capturedPath: unknown;
    const router = new Router().get('/things/:id/actions/:act', (req, res) => {
      capturedPath = getAbsolutePath(req);
      res.end();
    });

    return withServer(router, async (url) => {
      await expect(fetch(url + '/things/1/actions/dothing'), responds());
      expect(capturedPath).equals('/things/1/actions/dothing');
    });
  });

  it('preserves URL encoding', () => {
    let capturedPath: unknown;
    const router = new Router().get('/*any', (req, res) => {
      capturedPath = getAbsolutePath(req);
      res.end();
    });

    return withServer(router, async (url) => {
      await expect(fetch(url + '/thing%20blah-%65-woo'), responds());
      expect(capturedPath).equals('/thing%20blah-%65-woo');
    });
  });
});

describe('restoreAbsolutePath', () => {
  it('sets the request URL to the original path', () => {
    let initial: unknown;
    let restored: unknown;
    const router = new Router().mount(
      '/foo/bar',
      requestHandler((req, res) => {
        initial = req.url;
        restoreAbsolutePath(req);
        restored = req.url;
        res.end();
      }),
    );

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo/bar/baz'), responds());
      expect(initial).equals('/baz');
      expect(restored).equals('/foo/bar/baz');
    });
  });

  it('preserves URL encoding', () => {
    let initial: unknown;
    let restored: unknown;
    const router = new Router().mount(
      '/foo/bar',
      requestHandler((req, res) => {
        initial = req.url;
        restoreAbsolutePath(req);
        restored = req.url;
        res.end();
      }),
    );

    return withServer(router, async (url) => {
      await expect(fetch(url + '/f%6f%6f/bar/b%61z'), responds());
      expect(initial).equals('/baz'); // TODO: would be nice if this could be '/b%61z'
      expect(restored).equals('/f%6f%6f/bar/b%61z');
    });
  });
});
