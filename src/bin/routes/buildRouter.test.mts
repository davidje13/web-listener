import { join } from 'node:path';
import { requestHandler } from '../../index.mts';
import { makeTestTempDir } from '../../test-helpers/makeFileStructure.mts';
import { responds } from '../../test-helpers/responds.mts';
import { withServer } from '../../test-helpers/withServer.mts';
import type { ConfigMount } from '../config/types.mts';
import { buildRouter, type LogInfo } from './buildRouter.mts';
import 'lean-test';

describe('buildRouter', () => {
  describe('files', () => {
    const TEST_DIR = makeTestTempDir('br-', { 'file.txt': 'Content' });

    it('adds file server middleware', { timeout: 3000 }, async ({ getTyped }) => {
      const router = await buildRouter([
        { type: 'files', dir: getTyped(TEST_DIR), path: '/', options: {} },
      ]);
      return withServer(router, async (url) => {
        await expect(fetch(url + '/file.txt'), responds({ body: 'Content' }));
      });
    });
  });

  describe('proxy', () => {
    it('adds proxy middleware', { timeout: 3000 }, () => {
      const upstream = requestHandler((req, res) => {
        res.end(`upstream handling ${req.method} ${req.url}`);
      });

      return withServer(upstream, async (upstreamUrl) => {
        const router = await buildRouter([
          { type: 'proxy', target: upstreamUrl, path: '/', options: {} },
        ]);
        return withServer(router, async (url) => {
          await expect(fetch(url), responds({ body: 'upstream handling GET /' }));
        });
      });
    });
  });

  describe('fixture', () => {
    it('adds fixtures', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'fixture',
          method: 'GET',
          path: '/',
          status: 299,
          headers: { foo: 'bar' },
          body: 'Hi',
        },
        {
          type: 'fixture',
          method: 'POST',
          path: '/2',
          status: 200,
          headers: {},
          body: 'Reply',
        },
      ]);
      return withServer(router, async (url) => {
        await expect(fetch(url), responds({ status: 299, headers: { foo: 'bar' }, body: 'Hi' }));
        await expect(
          fetch(url + '/2', { method: 'POST' }),
          responds({ status: 200, body: 'Reply' }),
        );
      });
    });

    it('supports basic templating', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'fixture',
          method: 'GET',
          path: '/:p1/*p2',
          status: 200,
          headers: { foo: 'pre-${p1}-post' },
          body: 'Got ${p1:-blank} ${p2:-blank} ${p3:-blank} ${?q1:-blank}',
        },
      ]);
      return withServer(router, async (url) => {
        await expect(
          fetch(url + '/foo/bar'),
          responds({ headers: { foo: 'pre-foo-post' }, body: 'Got foo bar blank blank' }),
        );
        await expect(
          fetch(url + '/foo/bar/baz?q1=zig'),
          responds({ body: 'Got foo bar/baz blank zig' }),
        );
      });
    });

    it('supports encoding in template values', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'fixture',
          method: 'GET',
          path: '/{:p}',
          status: 200,
          headers: {},
          body: 'Got ${raw(p)} ${html(p)} ${html(p:-<b>fallback</b>)} ${html(p):-<b>fallback</b>} ${uri(p)}',
        },
      ]);
      return withServer(router, async (url) => {
        await expect(
          fetch(url + '/f<oo>'),
          responds({ body: 'Got f<oo> f&lt;oo&gt; f&lt;oo&gt; f&lt;oo&gt; f%3Coo%3E' }),
        );
        await expect(
          fetch(url + '/'),
          responds({ body: 'Got   &lt;b&gt;fallback&lt;/b&gt; <b>fallback</b> ' }),
        );
      });
    });
  });

  describe('redirect', () => {
    it('adds redirects', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'redirect',
          path: '/attempt',
          status: 307,
          target: '/other',
        },
        {
          type: 'fixture',
          method: 'GET',
          path: '/other',
          status: 200,
          headers: {},
          body: 'Redirected content',
        },
      ]);
      return withServer(router, async (url) => {
        await expect(
          fetch(url + '/attempt', { redirect: 'manual' }),
          responds({ status: 307, headers: { location: '/other' }, body: '' }),
        );
        await expect(
          fetch(url + '/attempt'),
          responds({ status: 200, headers: {}, body: 'Redirected content' }),
        );
        await expect(
          fetch(url + '/attempt', { method: 'POST', redirect: 'manual' }),
          responds({ status: 307, headers: { location: '/other' }, body: '' }),
        );
      });
    });

    it('supports basic templating', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'redirect',
          path: '/*route.html',
          status: 301,
          target: '/${route}.htm${?}',
        },
      ]);
      return withServer(router, async (url) => {
        await expect(
          fetch(url + '/file.html', { redirect: 'manual' }),
          responds({ status: 301, headers: { location: '/file.htm' } }),
        );
        await expect(
          fetch(url + '/nested/file.html', { redirect: 'manual' }),
          responds({ status: 301, headers: { location: '/nested/file.htm' } }),
        );
        await expect(
          fetch(url + '/file.html?query=string', { redirect: 'manual' }),
          responds({ status: 301, headers: { location: '/file.htm?query=string' } }),
        );
        await expect(
          fetch(url + '/encoded%25file%20name.html?a=b&c=d+e&f=%25', { redirect: 'manual' }),
          responds({
            status: 301,
            headers: { location: '/encoded%25file%20name.htm?a=b&c=d+e&f=%25' },
          }),
        );
      });
    });

    it('supports encoding in template values', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'redirect',
          path: '/*route',
          status: 301,
          target: '/go?path=${uri(route)}&q=${uri(?)}',
        },
      ]);
      return withServer(router, async (url) => {
        await expect(
          fetch(url + '/encoded%25path.html?a=b&c=d+e', { redirect: 'manual' }),
          responds({
            status: 301,
            headers: { location: '/go?path=encoded%25path.html&q=%3Fa%3Db%26c%3Dd%2Be' },
          }),
        );
      });
    });

    it('avoids accidental open redirects', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'redirect',
          path: '!/*route.html',
          status: 301,
          target: '/${route}.htm${?}',
        },
      ]);
      return withServer(router, async (url) => {
        await expect(
          fetch(url + '//file.html', { redirect: 'manual' }),
          responds({ status: 301, headers: { location: '/file.htm' } }),
        );
        await expect(
          fetch(url + '///file.html', { redirect: 'manual' }),
          responds({ status: 301, headers: { location: '/file.htm' } }),
        );
      });
    });

    it('allows intentional external redirects', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'redirect',
          path: '/*route',
          status: 301,
          target: 'https://example.com/${route}',
        },
      ]);
      return withServer(router, async (url) => {
        await expect(
          fetch(url + '/file', { redirect: 'manual' }),
          responds({ status: 301, headers: { location: 'https://example.com/file' } }),
        );
      });
    });
  });

  describe('redirect-map', () => {
    it('adds multiple redirects', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'redirect-map',
          mapping: { '/one': '/new-one', '/two': '/new-two' },
          status: 307,
          options: { caseSensitive: false },
        },
        FALLBACK_200,
      ]);
      return withServer(router, async (url) => {
        await expect(
          fetch(url + '/one', { redirect: 'manual' }),
          responds({ status: 307, headers: { location: '/new-one' }, body: '' }),
        );
        await expect(
          fetch(url + '/ONE', { redirect: 'manual' }),
          responds({ status: 307, headers: { location: '/new-one' }, body: '' }),
        );
        await expect(
          fetch(url + '/two', { redirect: 'manual' }),
          responds({ status: 307, headers: { location: '/new-two' }, body: '' }),
        );
        await expect(fetch(url + '/other', { redirect: 'manual' }), responds({ status: 200 }));
      });
    });

    it('can be case sensitive', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'redirect-map',
          mapping: { '/one': '/new-one' },
          status: 307,
          options: { caseSensitive: true },
        },
        FALLBACK_200,
      ]);
      return withServer(router, async (url) => {
        await expect(
          fetch(url + '/one', { redirect: 'manual' }),
          responds({ status: 307, headers: { location: '/new-one' }, body: '' }),
        );
        await expect(fetch(url + '/ONE', { redirect: 'manual' }), responds({ status: 200 }));
      });
    });

    it('allows routing paths to themselves to normalise case', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'redirect-map',
          mapping: { '/one': '/one' },
          status: 307,
          options: { caseSensitive: false },
        },
        FALLBACK_200,
      ]);
      return withServer(router, async (url) => {
        await expect(
          fetch(url + '/ONE', { redirect: 'manual' }),
          responds({ status: 307, headers: { location: '/one' }, body: '' }),
        );
        await expect(
          fetch(url + '/One', { redirect: 'manual' }),
          responds({ status: 307, headers: { location: '/one' }, body: '' }),
        );
        await expect(fetch(url + '/one', { redirect: 'manual' }), responds({ status: 200 }));
      });
    });

    const NGINX_MAPS = makeTestTempDir('map-', {
      'syntax.map': `
/foo /new-foo;
# comment
/bar\t/new-bar #comment
;
/baz
/new-baz ;
  /indented \t /new-indented
;
# /nope /new-nope; /nope /new-nope
/s1 /escaped\\ space;
/s2 "/quoted space";
`,
      'with-default.map': `
/foo /one;
default /other;
`,
      'regex.map': `
~*^/one/(.+)/end.(?<ext>.+)$ /new/$1.$ext;
~^/case/(.+)/end.(?<ext>.+)$ /new/$1.$ext;
`,
    });

    it(
      'loads mappings from an nginx-formatted mapping file',
      { timeout: 3000 },
      async ({ getTyped }) => {
        const router = await buildRouter([
          {
            type: 'redirect-map',
            mapping: join(getTyped(NGINX_MAPS), 'syntax.map'),
            status: 307,
            options: { caseSensitive: false },
          },
          FALLBACK_200,
        ]);
        return withServer(router, async (url) => {
          await expect(
            fetch(url + '/foo', { redirect: 'manual' }),
            responds({ status: 307, headers: { location: '/new-foo' }, body: '' }),
          );
          await expect(
            fetch(url + '/bar', { redirect: 'manual' }),
            responds({ status: 307, headers: { location: '/new-bar' }, body: '' }),
          );
          await expect(
            fetch(url + '/baz', { redirect: 'manual' }),
            responds({ status: 307, headers: { location: '/new-baz' }, body: '' }),
          );
          await expect(
            fetch(url + '/indented', { redirect: 'manual' }),
            responds({ status: 307, headers: { location: '/new-indented' }, body: '' }),
          );
          await expect(
            fetch(url + '/s1', { redirect: 'manual' }),
            responds({ status: 307, headers: { location: '/escaped space' }, body: '' }),
          );
          await expect(
            fetch(url + '/s2', { redirect: 'manual' }),
            responds({ status: 307, headers: { location: '/quoted space' }, body: '' }),
          );
          await expect(fetch(url + '/nope', { redirect: 'manual' }), responds({ status: 200 }));
        });
      },
    );

    it(
      'supports "default" in nginx-formatted mapping files',
      { timeout: 3000 },
      async ({ getTyped }) => {
        const router = await buildRouter([
          {
            type: 'redirect-map',
            mapping: join(getTyped(NGINX_MAPS), 'with-default.map'),
            status: 307,
            options: { caseSensitive: false },
          },
        ]);
        return withServer(router, async (url) => {
          await expect(
            fetch(url + '/foo', { redirect: 'manual' }),
            responds({ status: 307, headers: { location: '/one' }, body: '' }),
          );
          await expect(
            fetch(url + '/nope', { redirect: 'manual' }),
            responds({ status: 307, headers: { location: '/other' }, body: '' }),
          );
        });
      },
    );

    it(
      'supports regular expressions in nginx-formatted mapping files',
      { timeout: 3000 },
      async ({ getTyped }) => {
        const router = await buildRouter([
          {
            type: 'redirect-map',
            mapping: join(getTyped(NGINX_MAPS), 'regex.map'),
            status: 307,
            options: { caseSensitive: false },
          },
          FALLBACK_200,
        ]);
        return withServer(router, async (url) => {
          await expect(
            fetch(url + '/one/a/end.xyz', { redirect: 'manual' }),
            responds({ status: 307, headers: { location: '/new/a.xyz' }, body: '' }),
          );
          await expect(
            fetch(url + '/one/a/END.xyz', { redirect: 'manual' }),
            responds({ status: 307, headers: { location: '/new/a.xyz' }, body: '' }),
          );
          await expect(
            fetch(url + '/nope/one/a/end.xyz', { redirect: 'manual' }),
            responds({ status: 200 }),
          );
          await expect(
            fetch(url + '/case/b/end.w', { redirect: 'manual' }),
            responds({ status: 307, headers: { location: '/new/b.w' }, body: '' }),
          );
          await expect(
            fetch(url + '/case/b/END.w', { redirect: 'manual' }),
            responds({ status: 200 }),
          );
        });
      },
    );
  });

  it('logs requests', { timeout: 3000 }, async () => {
    const events: Omit<LogInfo, 'duration'>[] = [];
    const router = await buildRouter(
      [
        { type: 'fixture', method: 'GET', path: '/', status: 200, headers: {}, body: 'Hi' },
        { type: 'redirect', path: '/gone', status: 301, target: '/other' },
        { type: 'fixture', method: 'GET', path: '/spc@chars', status: 200, headers: {}, body: '' },
      ],
      () => {},
      (info) => events.push({ method: info.method, path: info.path, status: info.status }),
    );
    return withServer(router, async (url, { expectError }) => {
      await fetch(url);
      expect(events).equals([{ method: 'GET', path: '/', status: 200 }]);
      events.length = 0;

      await fetch(url + '/gone', { redirect: 'manual' });
      expect(events).equals([{ method: 'GET', path: '/gone', status: 301 }]);
      events.length = 0;

      await fetch(url + '/spc@chars');
      expect(events).equals([{ method: 'GET', path: '/spc@chars', status: 200 }]);
      events.length = 0;

      await fetch(url + '/spc%40chars');
      expect(events).equals([{ method: 'GET', path: '/spc%40chars', status: 200 }]);
      events.length = 0;

      await fetch(url + '/nope', { method: 'PUT' });
      expect(events).equals([{ method: 'PUT', path: '/nope', status: 404 }]);
      expectError('handling request /nope: HTTPError(404 Not Found)');
    });
  });

  describe('headers', () => {
    it('adds headers to all responses', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'headers',
          path: '/',
          headers: { foo: 'one', bar: 1, baz: ['one', 'two'] },
        },
        {
          type: 'fixture',
          method: 'GET',
          path: '/fixture',
          status: 200,
          headers: { other: 'fixture' },
          body: 'Hi',
        },
        { type: 'redirect', path: '/redirect', status: 307, target: '/target' },
      ]);

      return withServer(router, async (url) => {
        await expect(
          fetch(url + '/fixture'),
          responds({
            status: 200,
            headers: { foo: 'one', bar: '1', baz: 'one, two', other: 'fixture' },
            body: 'Hi',
          }),
        );
        await expect(
          fetch(url + '/redirect', { redirect: 'manual' }),
          responds({
            status: 307,
            headers: { foo: 'one', bar: '1', baz: 'one, two', location: '/target' },
          }),
        );
      });
    });

    it('is overridden by subsequent header definitions', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'headers',
          path: '/',
          headers: { location: 'one' },
        },
        {
          type: 'fixture',
          method: 'GET',
          path: '/fixture',
          status: 200,
          headers: { location: 'fixture' },
          body: 'Hi',
        },
        { type: 'redirect', path: '/redirect', status: 307, target: '/target' },
      ]);

      return withServer(router, async (url) => {
        await expect(
          fetch(url + '/fixture'),
          responds({ status: 200, headers: { location: 'fixture' } }),
        );
        await expect(
          fetch(url + '/redirect', { redirect: 'manual' }),
          responds({ status: 307, headers: { location: '/target' } }),
        );
      });
    });
  });

  describe('custom', () => {
    it('loads a custom Javascript handler', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'custom',
          method: 'GET',
          path: '/custom',
          import:
            'data:text/javascript;base64,' +
            btoa('export default (_, res) => res.end("My custom responder")'),
          namedExport: null,
          maskSubpaths: false,
        },
      ]);

      return withServer(router, async (url, { expectError }) => {
        await expect(
          fetch(url + '/custom'),
          responds({ status: 200, body: 'My custom responder' }),
        );

        await expect(fetch(url + '/custom', { method: 'POST' }), responds({ status: 404 }));
        await expect(fetch(url + '/custom', { method: 'HEAD' }), responds({ status: 200 }));
        await expect(fetch(url + '/custom/sub'), responds({ status: 404 }));

        expectError('handling request /custom: HTTPError(404 Not Found)');
        expectError('handling request /custom/sub: HTTPError(404 Not Found)');
      });
    });

    it('uses named exports if requested', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'custom',
          method: 'GET',
          path: '/custom',
          import:
            'data:text/javascript;base64,' +
            btoa('export const foo = (_, res) => res.end("My custom responder")'),
          namedExport: 'foo',
          maskSubpaths: false,
        },
      ]);

      return withServer(router, (url) =>
        expect(fetch(url + '/custom'), responds({ status: 200, body: 'My custom responder' })),
      );
    });

    it(
      'maps all verbs and subroutes to the handler if no method is specified',
      { timeout: 3000 },
      async () => {
        const router = await buildRouter([
          {
            type: 'custom',
            method: null,
            path: '/custom',
            import:
              'data:text/javascript;base64,' +
              btoa('export default (_, res) => res.end("My wildcard responder")'),
            namedExport: null,
            maskSubpaths: false,
          },
        ]);

        return withServer(router, async (url) => {
          await expect(
            fetch(url + '/custom'),
            responds({ status: 200, body: 'My wildcard responder' }),
          );
          await expect(
            fetch(url + '/custom', { method: 'POST' }),
            responds({ status: 200, body: 'My wildcard responder' }),
          );
          await expect(
            fetch(url + '/custom/sub'),
            responds({ status: 200, body: 'My wildcard responder' }),
          );
        });
      },
    );

    it(
      'maps the requested verb and no sub-routes if a method is specified',
      { timeout: 3000 },
      async () => {
        const router = await buildRouter([
          {
            type: 'custom',
            method: 'POST',
            path: '/custom',
            import:
              'data:text/javascript;base64,' +
              btoa('export default (_, res) => res.end("My post responder")'),
            namedExport: null,
            maskSubpaths: false,
          },
        ]);

        return withServer(router, async (url, { expectError }) => {
          await expect(
            fetch(url + '/custom', { method: 'POST' }),
            responds({ status: 200, body: 'My post responder' }),
          );
          await expect(fetch(url + '/custom'), responds({ status: 404 }));
          await expect(fetch(url + '/custom/sub', { method: 'POST' }), responds({ status: 404 }));

          expectError('handling request /custom: HTTPError(404 Not Found)');
          expectError('handling request /custom/sub: HTTPError(404 Not Found)');
        });
      },
    );

    it(
      'maps all requested verbs and no sub-routes if multiple methods are specified',
      { timeout: 3000 },
      async () => {
        const router = await buildRouter([
          {
            type: 'custom',
            method: ['POST', 'PUT'],
            path: '/custom',
            import:
              'data:text/javascript;base64,' +
              btoa('export default (_, res) => res.end("My post/put responder")'),
            namedExport: null,
            maskSubpaths: false,
          },
        ]);

        return withServer(router, async (url, { expectError }) => {
          await expect(
            fetch(url + '/custom', { method: 'POST' }),
            responds({ status: 200, body: 'My post/put responder' }),
          );
          await expect(
            fetch(url + '/custom', { method: 'PUT' }),
            responds({ status: 200, body: 'My post/put responder' }),
          );
          await expect(fetch(url + '/custom'), responds({ status: 404 }));
          await expect(fetch(url + '/custom/sub', { method: 'POST' }), responds({ status: 404 }));

          expectError('handling request /custom: HTTPError(404 Not Found)');
          expectError('handling request /custom/sub: HTTPError(404 Not Found)');
        });
      },
    );

    it('intercepts web-listener imports to avoid duplication', { timeout: 3000 }, async () => {
      const router = await buildRouter([
        {
          type: 'custom',
          method: null,
          path: '/custom',
          import:
            'data:text/javascript;base64,' +
            btoa(
              'import { isIntercepted } from "web-listener"; export default (_, res) => res.end(`Got ${isIntercepted}`)',
            ),
          namedExport: null,
          maskSubpaths: false,
        },
      ]);

      return withServer(router, async (url) => {
        await expect(fetch(url + '/custom'), responds({ status: 200, body: 'Got true' }));
      });
    });

    it('can mask the logged URL', { timeout: 3000 }, async () => {
      const loggedPaths: string[] = [];
      const router = await buildRouter(
        [
          {
            type: 'custom',
            method: null,
            path: '/custom',
            import:
              'data:text/javascript;base64,' +
              btoa('export default (_, res) => res.end("Sensitive")'),
            namedExport: null,
            maskSubpaths: true,
          },
        ],
        () => {},
        (log) => loggedPaths.push(log.path),
      );

      return withServer(router, async (url) => {
        await fetch(url + '/custom/sensitive-path/more?query');
        expect(loggedPaths).contains('/custom/[***]');
        loggedPaths.length = 0;

        await fetch(url + '/custom?query');
        expect(loggedPaths).contains('/custom?[***]');
        loggedPaths.length = 0;

        await fetch(url + '/custom/?query');
        expect(loggedPaths).contains('/custom/?[***]');
        loggedPaths.length = 0;

        await fetch(url + '/custom/');
        expect(loggedPaths).contains('/custom/');
        loggedPaths.length = 0;

        await fetch(url + '/custom');
        expect(loggedPaths).contains('/custom');
      });
    });
  });
});

const FALLBACK_200: ConfigMount = {
  type: 'fixture',
  method: 'GET',
  path: '/*any',
  body: '',
  status: 200,
  headers: {},
};
