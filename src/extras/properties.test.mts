import { withServer } from '../test-helpers/withServer.mts';
import { responds } from '../test-helpers/responds.mts';
import { Router } from '../core/Router.mts';
import { requestHandler } from '../core/handler.mts';
import { CONTINUE } from '../core/RoutingInstruction.mts';
import { makeMemo, Property } from './properties.mts';
import 'lean-test';

describe('Property', () => {
  it('creates an arbitrary property to share between handlers', { timeout: 3000 }, () => {
    const myProp = new Property(() => 0);
    const router = new Router();
    router.get('/', (req) => {
      myProp.set(req, 10);
      return CONTINUE;
    });
    router.get('/', (req, res) => {
      res.end(JSON.stringify(myProp.get(req)));
    });

    return withServer(router, async (url) => {
      expect(await fetchJSON(url)).equals(10);
    });
  });

  it('uses the given factory if the property has not been set', { timeout: 3000 }, () => {
    const myProp = new Property(() => 5);
    const handler = requestHandler((req, res) => {
      res.end(JSON.stringify(myProp.get(req)));
    });

    return withServer(handler, async (url) => {
      expect(await fetchJSON(url)).equals(5);
    });
  });

  it('throws by default if the property has not been set', { timeout: 3000 }, () => {
    const myProp = new Property<number>();
    const handler = requestHandler((req) => {
      myProp.get(req);
    });

    return withServer(handler, async (url, { expectError }) => {
      await expect(fetch(url), responds({ status: 500 }));
      expectError('handling request /: Error: property has not been set');
    });
  });

  it('provides convenience middleware for setting a constant value', { timeout: 3000 }, () => {
    const myProp = new Property<number>();
    const router = new Router();
    router.use(myProp.withValue(7));
    router.get('/', (req, res) => res.end(JSON.stringify(myProp.get(req))));

    return withServer(router, async (url) => {
      expect(await fetchJSON(url)).equals(7);
    });
  });

  it('is not shared between requests', { timeout: 3000 }, () => {
    const myProp = new Property(() => 5);
    const router = new Router();
    router.get('/one', (req, res) => {
      myProp.set(req, 10);
      res.end(JSON.stringify(myProp.get(req)));
    });
    router.get('/two', (req, res) => {
      res.end(JSON.stringify(myProp.get(req)));
    });

    return withServer(router, async (url) => {
      expect(await fetchJSON(url + '/one')).equals(10);
      expect(await fetchJSON(url + '/two')).equals(5);
    });
  });

  it('is only calculated once per request', { timeout: 3000 }, () => {
    let factoryCount = 0;
    const myProp = new Property(() => {
      factoryCount++;
      return 5;
    });
    const handler = requestHandler((req, res) => {
      myProp.get(req);
      myProp.get(req);
      res.end();
    });

    return withServer(handler, async (url) => {
      expect(factoryCount).equals(0);
      await fetch(url);
      expect(factoryCount).equals(1);
      await fetch(url);
      expect(factoryCount).equals(2);
    });
  });

  it('is reset by clear', { timeout: 3000 }, () => {
    let factoryCount = 0;
    const myProp = new Property(() => {
      factoryCount++;
      return 5;
    });
    const handler = requestHandler((req, res) => {
      myProp.set(req, 10);
      myProp.clear(req);
      myProp.clear(req); // multiple clears do nothing
      res.end(JSON.stringify(myProp.get(req)));
    });

    return withServer(handler, async (url) => {
      await fetch(url);
      expect(await fetchJSON(url)).equals(5);
    });
  });
});

describe('makeMemo', () => {
  it('caches the result of a function per request', { timeout: 3000 }, () => {
    let counter = 0;
    const myMemo = makeMemo((req) => `${req.url} ${counter++}`);
    const handler = requestHandler((req, res) => {
      const v1 = myMemo(req);
      const v2 = myMemo(req);
      res.end(JSON.stringify([v1, v2]));
    });

    return withServer(handler, async (url) => {
      expect(await fetchJSON(url)).equals(['/ 0', '/ 0']);
      expect(await fetchJSON(url + '/foo')).equals(['/foo 1', '/foo 1']);
    });
  });
});

const fetchJSON = (url: string) => fetch(url).then((res) => res.json());
