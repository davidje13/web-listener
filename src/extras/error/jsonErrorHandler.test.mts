import { withServer } from '../../test-helpers/withServer.mts';
import { requestHandler } from '../../core/handler.mts';
import { HTTPError } from '../../core/HTTPError.mts';
import { Router } from '../../core/Router.mts';
import { jsonErrorHandler } from './jsonErrorHandler.mts';
import 'lean-test';

describe('jsonErrorHandler', () => {
  it('sends errors as JSON using the given format', { timeout: 3000 }, () => {
    const errorHandler = jsonErrorHandler((err) => ({ error: err.body, extra: 'hi' }));
    return withServer(
      new Router().get('/', DO_THROW, errorHandler),
      async (url, { expectError }) => {
        const res = await fetch(url, { headers: { accept: 'application/json;q=0.9' } });
        expect(res.status).equals(555);
        expect(res.headers.get('content-type')).equals('application/json');
        expect(await res.text()).equals('{"error":"oops","extra":"hi"}');
        expectError('handling request /: HTTPError(555 -): oops');
      },
    );
  });

  it('sends as plain text if the client does not request JSON', { timeout: 3000 }, () => {
    const errorHandler = jsonErrorHandler((err) => ({ error: err.body }));
    return withServer(
      new Router().get('/', DO_THROW, errorHandler),
      async (url, { expectError }) => {
        const res = await fetch(url, { headers: {} });
        expect(res.status).equals(555);
        expect(res.headers.get('content-type')).equals('text/plain; charset=utf-8');
        expect(await res.text()).equals('oops');
        expectError('handling request /: HTTPError(555 -): oops');
      },
    );
  });

  it('can be forced to send JSON regardless of the client preference', { timeout: 3000 }, () => {
    const errorHandler = jsonErrorHandler((err) => ({ error: err.body }), {
      onlyIfRequested: false,
    });
    return withServer(
      new Router().get('/', DO_THROW, errorHandler),
      async (url, { expectError }) => {
        const res = await fetch(url, { headers: {} });
        expect(res.status).equals(555);
        expect(res.headers.get('content-type')).equals('application/json');
        expect(await res.text()).equals('{"error":"oops"}');
        expectError('handling request /: HTTPError(555 -): oops');
      },
    );
  });

  it('can be forced to use a constant status', { timeout: 3000 }, () => {
    const errorHandler = jsonErrorHandler((err) => ({ error: err.body, status: err.statusCode }), {
      forceStatus: 200,
    });
    return withServer(
      new Router().get('/', DO_THROW, errorHandler),
      async (url, { expectError }) => {
        const res = await fetch(url, { headers: { accept: 'application/json' } });
        expect(res.status).equals(200);
        expect(await res.text()).equals('{"error":"oops","status":555}');
        expectError('handling request /: HTTPError(555 -): oops');
      },
    );
  });

  it('can use an alternative content-type', { timeout: 3000 }, () => {
    const errorHandler = jsonErrorHandler((err) => ({ error: err.body, status: err.statusCode }), {
      contentType: 'application/json+error',
    });
    return withServer(
      new Router().get('/', DO_THROW, errorHandler),
      async (url, { expectError }) => {
        const res = await fetch(url, { headers: { accept: 'application/json' } });
        expect(res.headers.get('content-type')).equals('application/json+error');
        expectError('handling request /: HTTPError(555 -): oops');
      },
    );
  });

  it('does not emit the error if emitError is false', { timeout: 3000 }, () => {
    const errorHandler = jsonErrorHandler((err) => ({ error: err.body }), { emitError: false });
    return withServer(new Router().get('/', DO_THROW, errorHandler), async (url) => {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      expect(res.status).equals(555);
      expect(res.headers.get('content-type')).equals('application/json');
    });
  });
});

const DO_THROW = requestHandler(() => {
  throw new HTTPError(555, { body: 'oops' });
});
