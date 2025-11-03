import { withServer } from '../test-helpers/withServer.mts';
import { responds } from '../test-helpers/responds.mts';
import { Router } from './Router.mts';
import { requestHandler } from './handler.mts';
import { getQuery, getSearch, getSearchParams } from './queryParameters.mts';
import 'lean-test';

describe('getSearch', () => {
  it('returns the search component of the request URL', { timeout: 3000 }, () => {
    let capturedSearch: unknown;
    const router = new Router().mount(
      '/foo',
      requestHandler((req, res) => {
        capturedSearch = getSearch(req);
        res.end();
      }),
    );

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo/bar?one=1&two=2'), responds());
      expect(capturedSearch).equals('?one=1&two=2');

      await expect(fetch(url + '/foo?'), responds());
      expect(capturedSearch).equals('');

      await expect(fetch(url + '/foo'), responds());
      expect(capturedSearch).equals('');
    });
  });
});

describe('getSearchParams', () => {
  it('returns the search parameters for the request URL', { timeout: 3000 }, () => {
    let capturedParams: unknown;
    const router = new Router().mount(
      '/foo',
      requestHandler((req, res) => {
        capturedParams = getSearchParams(req);
        res.end();
      }),
    );

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo/bar?one=1&two=2'), responds());
      expect(capturedParams).equals(
        new URLSearchParams([
          ['one', '1'],
          ['two', '2'],
        ]),
      );

      await expect(fetch(url + '/foo'), responds());
      expect(capturedParams).equals(new URLSearchParams([]));
    });
  });
});

describe('getQuery', () => {
  it('returns a single search parameter from the request URL', { timeout: 3000 }, () => {
    let capturedParam: unknown;
    const router = new Router().mount(
      '/foo',
      requestHandler((req, res) => {
        capturedParam = getQuery(req, 'one');
        res.end();
      }),
    );

    return withServer(router, async (url) => {
      await expect(fetch(url + '/foo/bar?one=1&two=2'), responds());
      expect(capturedParam).equals('1');

      await expect(fetch(url + '/foo'), responds());
      expect(capturedParam).equals(null);
    });
  });
});
