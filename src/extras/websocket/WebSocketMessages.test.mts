import { WebSocketServer } from 'ws';
import { withServer } from '../../test-helpers/withServer.mts';
import { makeWebSocketConnection } from '../../test-helpers/makeWebSocketConnection.mts';
import { Router } from '../../core/Router.mts';
import { makeAcceptWebSocket } from './acceptWebSocket.mts';
import {
  nextWebSocketMessage,
  WebSocketMessages,
  type WebSocketMessage,
} from './WebSocketMessages.mts';
import 'lean-test';

describe('WebSocketMessages', () => {
  it('consumes messages into a blocking queue', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const router = new Router();
    router.ws('/', async (req) => {
      const ws = await acceptWebSocket(req);
      const messages = new WebSocketMessages(ws);
      for await (const message of messages) {
        ws.send(`echo ${message.text}`);
      }
    });

    return withServer(router, async (url) => {
      const { ws, next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      ws.send('one');
      expect(await next()).equals('MESSAGE: echo one');
      ws.send('two');
      expect(await next()).equals('MESSAGE: echo two');
      ws.close();
      await closed();
    });
  });

  it('makes individual messages available', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const router = new Router();
    let received: Promise<WebSocketMessage> | undefined;
    router.ws('/', async (req) => {
      const ws = await acceptWebSocket(req);
      const messages = new WebSocketMessages(ws);
      received = messages.next();
    });

    return withServer(router, async (url) => {
      const { ws, next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      ws.send('one');
      expect((await received!).text).equals('one');
      ws.close();
      await closed();
    });
  });

  it('queues requests for messages', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const router = new Router();
    let received1: Promise<WebSocketMessage> | undefined;
    let received2: Promise<WebSocketMessage> | undefined;
    router.ws('/', async (req) => {
      const ws = await acceptWebSocket(req);
      const messages = new WebSocketMessages(ws);
      received1 = messages.next();
      received2 = messages.next();
    });

    return withServer(router, async (url) => {
      const { ws, next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      expect(received1).isTruthy();
      expect(received2).isTruthy();
      ws.send('one');
      expect((await received1!).text).equals('one');
      ws.send('two');
      expect((await received2!).text).equals('two');
      ws.close();
      await closed();
    });
  });

  it('throws if a message request times out', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const router = new Router();
    let received: Promise<WebSocketMessage | string> | undefined;
    router.ws('/', async (req) => {
      const ws = await acceptWebSocket(req);
      const messages = new WebSocketMessages(ws);
      received = messages.next(100).catch((err) => `caught ${err}`);
    });

    return withServer(router, async (url) => {
      const { ws, next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      expect(await received!).equals('caught Error: timeout after 100ms');
      ws.close();
      await closed();
    });
  });

  it('throws if the connection closes before a message is received', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const router = new Router();
    let received: Promise<WebSocketMessage | string> | undefined;
    router.ws('/', async (req) => {
      const ws = await acceptWebSocket(req);
      const messages = new WebSocketMessages(ws);
      received = messages.next().catch((err) => `caught ${err}`);
    });

    return withServer(router, async (url) => {
      const { ws, next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      ws.close();
      await closed();
      expect(await received!).equals('caught Error: connection closed');
    });
  });

  it('can be detached at any time', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const router = new Router();
    let received1: Promise<WebSocketMessage> | undefined;
    let received2: Promise<WebSocketMessage | string> | undefined;
    let detach: (() => void) | undefined;
    router.ws('/', async (req) => {
      const ws = await acceptWebSocket(req);
      const messages = new WebSocketMessages(ws);
      detach = messages.detach;
      received1 = messages.next();
      received2 = messages.next().catch((err) => `caught ${err}`);
    });

    return withServer(router, async (url) => {
      const { ws, next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      ws.send('one');
      expect((await received1!).text).equals('one');
      detach?.();
      expect(await received2!).equals('caught Error: WebSocket listener detached');
      ws.close();
      await closed();
    });
  });

  it('can automatically detach after a number of messages', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const router = new Router();
    let received1: Promise<WebSocketMessage> | undefined;
    let received2: Promise<WebSocketMessage> | undefined;
    let received3: Promise<WebSocketMessage | string> | undefined;
    router.ws('/', async (req) => {
      const ws = await acceptWebSocket(req);
      const messages = new WebSocketMessages(ws, { limit: 2 });
      received1 = messages.next();
      received2 = messages.next();
      received3 = messages.next().catch((err) => `caught ${err}`);
    });

    return withServer(router, async (url) => {
      const { ws, next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      ws.send('one');
      ws.send('two');
      ws.send('three');
      expect((await received1!).text).equals('one');
      expect((await received2!).text).equals('two');
      expect(await received3!).equals('caught Error: WebSocket listener detached');
      ws.close();
      await closed();
    });
  });
});

describe('nextWebSocketMessage', () => {
  it('returns a single message from the WebSocket', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const router = new Router();
    router.ws('/', async (req) => {
      const ws = await acceptWebSocket(req);
      const message = await nextWebSocketMessage(ws);
      ws.send(`echo ${message.text}`);
      ws.close();
    });

    return withServer(router, async (url) => {
      const { ws, next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      ws.send('one');
      expect(await next()).equals('MESSAGE: echo one');
      await closed();
    });
  });

  it('does not consume further messages', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const router = new Router();
    router.ws('/', async (req) => {
      const ws = await acceptWebSocket(req);
      const message1 = await nextWebSocketMessage(ws);
      ws.send(`echo1 ${message1.text}`);
      const message2 = await nextWebSocketMessage(ws);
      ws.send(`echo2 ${message2.text}`);
      ws.close();
    });

    return withServer(router, async (url) => {
      const { ws, next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      ws.send('one');
      expect(await next()).equals('MESSAGE: echo1 one');
      ws.send('two');
      expect(await next()).equals('MESSAGE: echo2 two');
      await closed();
    });
  });

  it('does not consume a message if it times out', { timeout: 3000 }, () => {
    const acceptWebSocket = makeAcceptWebSocket(WebSocketServer);

    const router = new Router();
    router.ws('/', async (req) => {
      const ws = await acceptWebSocket(req);
      const message1 = await nextWebSocketMessage(ws, { timeout: 50 }).catch((err) => err);
      ws.send(String(message1));
      const message2 = await nextWebSocketMessage(ws);
      ws.send(`echo ${message2.text}`);
      ws.close();
    });

    return withServer(router, async (url) => {
      const { ws, next, closed } = makeWebSocketConnection(url);
      expect(await next()).equals('OPEN');
      expect(await next()).equals('MESSAGE: Error: timeout after 50ms');
      ws.send('one');
      expect(await next()).equals('MESSAGE: echo one');
      await closed();
    });
  });
});
