import { withServer } from '../test-helpers/withServer.mts';
import { responds } from '../test-helpers/responds.mts';
import { Router } from './Router.mts';
import { CONTINUE } from './RoutingInstruction.mts';
import { requestHandler } from './handler.mts';
import {
  addTeardown,
  defer,
  getAbortSignal,
  isSoftClosed,
  scheduleClose,
  setSoftCloseHandler,
} from './close.mts';
import '../polyfill/fetch.mts';
import 'lean-test';

describe('soft close', () => {
  it('notifies open connections that they should close', { timeout: 3000 }, () => {
    const events: string[] = [];
    const handler = requestHandler((req, res) => {
      events.push('initial soft close state: ' + isSoftClosed(req));
      setSoftCloseHandler(req, (reason) => {
        events.push('soft close called: ' + reason);
        events.push('new soft close state: ' + isSoftClosed(req));
        res.end();
      });
    });

    return withServer(handler, async (url, { listeners }) => {
      const request = fetch(url).catch(fail);
      await expect.poll(() => events, equals(['initial soft close state: false']));

      listeners.softClose('going away', (error) => fail(String(error)));
      const res = await request;
      expect(events).equals([
        'initial soft close state: false',
        'soft close called: going away',
        'new soft close state: true',
      ]);
      expect(res!.headers.get('connection')).equals('close');
    });
  });

  it('reports errors back to the invoker', { timeout: 3000 }, () => {
    const events: string[] = [];
    const handler = requestHandler((req, res) => {
      events.push('received request');
      setSoftCloseHandler(req, () => {
        res.end();
        throw 'oops';
      });
    });

    return withServer(handler, async (url, { listeners }) => {
      const request = fetch(url).catch(fail);
      await expect.poll(() => events, equals(['received request']));

      const capturedErrors: unknown[] = [];
      listeners.softClose('going away', (error) => capturedErrors.push(error));
      const res = await request;
      expect(res!.status).equals(200);
      expect(capturedErrors).equals(['oops']);
    });
  });
});

describe('hard close', () => {
  it('closes existing connections immediately', { timeout: 3000 }, () => {
    const events: string[] = [];
    const handler = requestHandler(() => {
      events.push('received request');
    });

    return withServer(handler, async (url, { server, listeners }) => {
      const request = fetch(url).catch(fail);
      await expect.poll(() => events, equals(['received request']));

      listeners.hardClose(() => server.closeAllConnections());
      const res = await request;
      expect(res!.status).equals(503);
      expect(res!.headers.get('connection')).equals('close');
      expect(await res!.bytes()).isEmpty();
    });
  });

  it('closes connections cleanly if they have already begun responding', { timeout: 3000 }, () => {
    const events: string[] = [];
    const handler = requestHandler((_, res) => {
      events.push('received request');
      res.write('data');
    });

    return withServer(handler, async (url, { server, listeners }) => {
      const request = fetch(url).catch(fail);
      await expect.poll(() => events, equals(['received request']));

      listeners.hardClose(() => server.closeAllConnections());
      const res = await request;
      expect(res!.status).equals(200);
      expect(await res!.text()).equals('data');
    });
  });

  it(
    'provides a callback to explicitly close connections which have not made any request',
    { timeout: 3000 },
    () => {
      const handler = requestHandler(() => {});

      return withServer(handler, async (url, { server, listeners }) => {
        const input = new TransformStream<Uint8Array>();
        const madeConnection = new Promise((resolve) => server.once('connection', resolve));
        const request = fetch(url, { method: 'POST', body: input.readable, duplex: 'half' }).catch(
          (err) => String(err),
        );
        await madeConnection;

        listeners.hardClose(() => server.closeAllConnections());
        const res = await request;
        expect(res).equals('TypeError: fetch failed');
      });
    },
  );

  it('closes connections which are still sending data', { timeout: 3000 }, () => {
    const events: string[] = [];
    const handler = requestHandler(() => {
      events.push('received request');
    });

    return withServer(handler, async (url, { server, listeners }) => {
      const input = new TransformStream<Uint8Array>();
      const writer = input.writable.getWriter();
      const request = fetch(url, { method: 'POST', body: input.readable, duplex: 'half' }).catch(
        (err) => err,
      );
      writer.write(Buffer.from('chunk1'));
      await expect.poll(() => events, equals(['received request']), { timeout: 500 });

      listeners.hardClose(() => server.closeAllConnections());
      const res = await request;
      expect(res.status).equals(503);
      expect(await res.text()).equals('');
      await expect.poll(() => listeners.countConnections(), equals(0), { timeout: 500 });
    });
  });
});

describe('scheduleClose', () => {
  it('schedules hard closure of a single request', { timeout: 3000 }, () => {
    const handler = requestHandler((req) => {
      scheduleClose(req, 'timeout', Date.now() + 50);
    });

    return withServer(handler, async (url) => {
      const begin = Date.now();
      const res = await fetch(url);
      const end = Date.now();
      expect(end - begin).isLessThan(500);
      expect(res.status).equals(503);
    });
  });

  it('allows soft-closing with a buffer time', { timeout: 3000 }, () => {
    const events: string[] = [];
    const handler = requestHandler((req, res) => {
      setSoftCloseHandler(req, (reason) => {
        events.push('soft close called: ' + reason);
        res.end();
      });
      scheduleClose(req, 'timeout', Date.now() + 1000, 950);
    });

    return withServer(handler, async (url) => {
      const begin = Date.now();
      const res = await fetch(url);
      const end = Date.now();
      expect(end - begin).isLessThan(500);
      expect(res.status).equals(200);
      expect(events).equals(['soft close called: timeout']);
    });
  });

  it('hard closes if the request ignores the soft close event', { timeout: 3000 }, () => {
    const handler = requestHandler((req) => {
      setSoftCloseHandler(req, () => {});
      scheduleClose(req, 'timeout', Date.now() + 50, 20);
    });

    return withServer(handler, async (url) => {
      const begin = Date.now();
      const res = await fetch(url);
      const end = Date.now();
      expect(end - begin).isLessThan(500);
      expect(res.status).equals(503);
    });
  });

  it('reports soft close errors back', { timeout: 3000 }, () => {
    const capturedErrors: unknown[] = [];
    const handler = requestHandler((req) => {
      setSoftCloseHandler(req, () => {
        throw 'oops';
      });
      scheduleClose(req, 'timeout', Date.now() + 100, 50, (error, action) => {
        capturedErrors.push({ error, action });
      });
    });

    return withServer(handler, async (url) => {
      const begin = Date.now();
      const res = await fetch(url);
      const end = Date.now();
      expect(end - begin).isLessThan(500);
      expect(res.status).equals(503);
      expect(capturedErrors).equals([{ error: 'oops', action: 'soft closing' }]);
    });
  });
});

describe('defer', () => {
  it('defers tasks until after the current handler has completed', { timeout: 3000 }, () => {
    const events: string[] = [];
    const router = new Router().get(
      '/',
      (req) => {
        events.push('begin 1');
        defer(req, () => void events.push('deferred 1 a'));
        defer(req, () => void events.push('deferred 1 b'));
        events.push('complete 1');
        return CONTINUE;
      },
      (req, res) => {
        events.push('begin 2');
        defer(req, () => void events.push('deferred 2'));
        events.push('complete 2');
        res.end();
      },
    );

    return withServer(router, async (url) => {
      await expect(fetch(url), responds());
      expect(events).equals([
        'begin 1',
        'complete 1',
        'deferred 1 b',
        'deferred 1 a',
        'begin 2',
        'complete 2',
        'deferred 2',
      ]);
    });
  });

  it('runs the task immediately if the request has already ended', { timeout: 3000 }, () => {
    const events: string[] = [];
    const router = new Router().get('/', (req, res) => {
      defer(req, () => void events.push('deferred before end'));
      res.end(() => setTimeout(() => defer(req, () => void events.push('deferred after end')), 0));
    });

    return withServer(router, async (url) => {
      await expect(fetch(url), responds());
      await expect.poll(() => events, equals(['deferred before end', 'deferred after end']), {
        timeout: 500,
      });
    });
  });

  it('executes if the handler throws', { timeout: 3000 }, () => {
    const events: string[] = [];
    const router = new Router().get(
      '/',
      (req) => {
        events.push('begin 1');
        defer(req, () => void events.push('deferred 1'));
        throw CONTINUE;
      },
      (req) => {
        events.push('begin 2');
        defer(req, () => void events.push('deferred 2'));
        events.push('complete 2');
        throw 'oops';
      },
    );

    return withServer(router, async (url, { expectError }) => {
      await expect(fetch(url), responds());
      expect(events).equals(['begin 1', 'deferred 1', 'begin 2', 'complete 2', 'deferred 2']);
      expectError('handling request /: oops');
    });
  });

  it('continues if a deferred task throws', { timeout: 3000 }, () => {
    const events: string[] = [];
    const router = new Router().get('/', (req) => {
      defer(req, () => void events.push('deferred 1'));
      defer(req, () => {
        throw 'deferred oops';
      });
      defer(req, () => void events.push('deferred 2'));
    });

    return withServer(router, async (url, { expectError }) => {
      await expect(fetch(url), responds());
      expect(events).equals(['deferred 2', 'deferred 1']);
      expectError('handling request /: deferred oops');
    });
  });
});

describe('addTeardown', () => {
  it('runs tasks after the message has finished being processed', { timeout: 3000 }, () => {
    const events: string[] = [];
    const router = new Router().get(
      '/',
      (req) => {
        events.push('begin 1');
        addTeardown(req, () => void events.push('teardown 1 a'));
        addTeardown(req, () => void events.push('teardown 1 b'));
        events.push('complete 1');
        return CONTINUE;
      },
      (req, res) => {
        events.push('begin 2');
        addTeardown(req, () => void events.push('teardown 2'));
        events.push('complete 2');
        res.end();
      },
    );

    return withServer(router, async (url) => {
      await expect(fetch(url), responds());
      expect(events).equals([
        'begin 1',
        'complete 1',
        'begin 2',
        'complete 2',
        'teardown 2',
        'teardown 1 b',
        'teardown 1 a',
      ]);
    });
  });

  it('runs the task immediately if the request has already ended', { timeout: 3000 }, () => {
    const events: string[] = [];
    const router = new Router().get('/', (req, res) => {
      addTeardown(req, () => void events.push('teardown before end'));
      res.end(() =>
        setTimeout(() => addTeardown(req, () => void events.push('teardown after end')), 0),
      );
    });

    return withServer(router, async (url) => {
      await expect(fetch(url), responds());
      await expect.poll(() => events, equals(['teardown before end', 'teardown after end']), {
        timeout: 500,
      });
    });
  });

  it('executes if the handlers fail', { timeout: 3000 }, () => {
    const events: string[] = [];
    const router = new Router().get(
      '/',
      (req) => {
        events.push('begin 1');
        addTeardown(req, () => void events.push('teardown 1'));
        throw CONTINUE;
      },
      (req) => {
        events.push('begin 2');
        addTeardown(req, () => void events.push('teardown 2'));
        events.push('complete 2');
        throw 'oops';
      },
    );

    return withServer(router, async (url, { expectError }) => {
      await expect(fetch(url), responds());
      expect(events).equals(['begin 1', 'begin 2', 'complete 2', 'teardown 2', 'teardown 1']);
      expectError('handling request /: oops');
    });
  });

  it('runs after deferred tasks', { timeout: 3000 }, () => {
    const events: string[] = [];
    const router = new Router().get('/', (req, res) => {
      defer(req, async () => {
        events.push('deferred begin');
        await new Promise((resolve) => setTimeout(resolve, 20));
        events.push('deferred end');
      });
      addTeardown(req, () => void events.push('teardown'));
      res.end();
    });

    return withServer(router, async (url) => {
      await expect(fetch(url), responds());
      await expect.poll(() => events, equals(['deferred begin', 'deferred end', 'teardown']), {
        timeout: 3000,
      });
    });
  });

  it('continues if a teardown throws', { timeout: 3000 }, () => {
    const events: string[] = [];
    const router = new Router().get('/', (req, res) => {
      addTeardown(req, () => void events.push('teardown 1'));
      addTeardown(req, () => {
        throw 'teardown oops';
      });
      addTeardown(req, () => void events.push('teardown 2'));
      res.end();
    });

    return withServer(router, async (url, { expectError }) => {
      await expect(fetch(url), responds());
      expect(events).equals(['teardown 2', 'teardown 1']);
      expectError('tearing down /: teardown oops');
    });
  });
});

describe('getAbortSignal', () => {
  it('returns an AbortSignal which fires when the request is cancelled', { timeout: 3000 }, () => {
    let received = false;
    let aborted = false;
    let abortReason: unknown;
    const handler = requestHandler((req) => {
      received = true;
      const signal = getAbortSignal(req);
      signal.addEventListener('abort', () => {
        aborted = true;
        abortReason = signal.reason;
      });
    });

    return withServer(handler, async (url) => {
      const ac = new AbortController();
      const request = fetch(url, { signal: ac.signal }).catch(() => {});
      await expect.poll(() => received, isTrue(), { timeout: 500 });
      ac.abort();
      await request;
      await expect.poll(() => aborted, withMessage('expected abort to be called', isTrue()), {
        timeout: 500,
      });
      expect(abortReason).equals('client abort');
    });
  });

  it('fires when the request completes normally', { timeout: 3000 }, () => {
    let aborted = false;
    let abortReason: unknown;
    const handler = requestHandler((req, res) => {
      const signal = getAbortSignal(req);
      signal.addEventListener('abort', () => {
        aborted = true;
        abortReason = signal.reason;
      });
      res.end();
    });

    return withServer(handler, async (url) => {
      const ac = new AbortController();
      await fetch(url, { signal: ac.signal }).catch(() => {});
      expect(aborted).isTrue();
      expect(abortReason).equals('complete');
    });
  });
});
