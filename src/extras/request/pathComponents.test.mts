import { platform } from 'node:os';
import { withServer } from '../../test-helpers/withServer.mts';
import { Router } from '../../core/Router.mts';
import { requestHandler } from '../../core/handler.mts';
import { getRemainingPathComponents } from './pathComponents.mts';
import 'lean-test';

describe('getRemainingPathComponents', () => {
  it('returns the remaining path, split into components', { timeout: 3000 }, () => {
    const router = new Router().mount(
      '/foo/:any',
      requestHandler((req, res) => {
        res.end(JSON.stringify(getRemainingPathComponents(req)));
      }),
    );

    return withServer(router, async (url) => {
      expect(await fetchJSON(url + '/foo/blah/zig/zag')).equals(['zig', 'zag']);
      expect(await fetchJSON(url + '/foo/blah/zig/zag/')).equals(['zig', 'zag', '']);
      expect(await fetchJSON(url + '/foo/blah/')).equals([]);
      expect(await fetchJSON(url + '/foo/blah')).equals([]);
    });
  });

  it('url-decodes each component', { timeout: 3000 }, () => {
    const handler = requestHandler((req, res) => {
      res.end(JSON.stringify(getRemainingPathComponents(req)));
    });

    return withServer(handler, async (url) => {
      expect(await fetchJSON(url + '/f%6f%6f/b%61r/%25')).equals(['foo', 'bar', '%']);
    });
  });

  it('throws if the path is potentially unsafe', { timeout: 3000 }, () => {
    const handler = requestHandler((req, res) => {
      try {
        res.end(JSON.stringify(getRemainingPathComponents(req)));
      } catch (err) {
        res.end(JSON.stringify(String(err)));
      }
    });

    return withServer(handler, async (url) => {
      expect(await fetchJSON(url + '/double//slash')).equals('Error: invalid path');
      expect(await fetchJSON(url + '/%10')).equals('Error: invalid path');

      // TODO: this gets filtered out before reaching getRemainingPathComponents
      //const res = await rawRequest(url + '/a/%2e%2e/b');
      //expect(res).contains('Error: invalid path');

      if (platform() === 'win32') {
        expect(await fetchJSON(url + '/CON1')).equals('Error: invalid path');
      } else {
        expect(await fetchJSON(url + '/~')).equals('Error: invalid path');
      }
    });
  });

  it(
    'allows potentially unsafe paths if rejectPotentiallyUnsafe is false',
    { timeout: 3000 },
    () => {
      const handler = requestHandler((req, res) => {
        res.end(
          JSON.stringify(getRemainingPathComponents(req, { rejectPotentiallyUnsafe: false })),
        );
      });

      return withServer(handler, async (url) => {
        expect(await fetchJSON(url + '/double//slash')).equals(['double', '', 'slash']);
        expect(await fetchJSON(url + '/%10')).equals(['\u0010']);

        if (platform() === 'win32') {
          expect(await fetchJSON(url + '/CON1')).equals(['CON1']);
        } else {
          expect(await fetchJSON(url + '/~')).equals(['~']);
        }
      });
    },
  );

  // TODO: slashes are currently decoded before splitting
  it.ignore('preserves url-encoded slashes', { timeout: 3000 }, () => {
    const handler = requestHandler((req, res) => {
      res.end(JSON.stringify(getRemainingPathComponents(req, { rejectPotentiallyUnsafe: false })));
    });

    return withServer(handler, async (url) => {
      expect(await fetchJSON(url + '/foo%2fbar')).equals(['foo/bar']);
    });
  });
});

const fetchJSON = (url: string) => fetch(url).then((res) => res.json());
