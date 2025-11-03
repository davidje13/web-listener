import { EventSource } from 'eventsource';
import { withServer } from '../../test-helpers/withServer.mts';
import { makeStreamSearch } from '../../test-helpers/streamSearch.mts';
import { rawRequest, rawRequestStream } from '../../test-helpers/rawRequest.mts';
import { BlockingQueue } from '../../util/BlockingQueue.mts';
import { requestHandler, type Handler } from '../../core/handler.mts';
import { ServerSentEvents } from './ServerSentEvents.mts';
import 'lean-test';

describe('ServerSentEvents', () => {
  it('provides a convenience wrapper around text/event-stream responses', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      const sse = new ServerSentEvents(req, res);
      await sse.send({ event: 'welcome', data: 'hello' });
      while (sse.open) {
        await sse.send({ data: 'tick' });
        // note: if the delay here is too low, we risk sending data when the client
        // is aborting the connection, which would lead to `Error: read ECONNRESET`
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    });

    return withServer(handler, async (url) => {
      const source = new EventSource(url);
      try {
        const messages = new BlockingQueue<string>();
        source.addEventListener('message', (ev) => {
          messages.push('message ' + ev.data);
        });
        source.addEventListener('welcome', (ev) => {
          messages.push('welcome ' + ev.data);
        });
        expect(await messages.shift()).equals('welcome hello');
        expect(await messages.shift()).equals('message tick');
        expect(await messages.shift()).equals('message tick');
      } finally {
        source.close();
      }
    });
  });

  it('sends event ID if given', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      const sse = new ServerSentEvents(req, res);
      await sse.send({ data: 'a' });
      await sse.send({ data: 'b', id: '1234' });
    });

    return withEventSource(handler, async ({ queue }) => {
      expect((await queue.shift()).lastEventId).equals('');
      expect((await queue.shift()).lastEventId).equals('1234');
    });
  });

  it('sends multiline and whitespace data', { timeout: 3000 }, () => {
    const data = ' foo \n\nbar\n\tbaz\t\n';
    const handler = requestHandler(async (req, res) => {
      const sse = new ServerSentEvents(req, res);
      await sse.send({ data });
    });

    return withEventSource(handler, async ({ queue }) => {
      expect((await queue.shift()).data).equals(data);
    });
  });

  it('sends data efficiently on the wire', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      const sse = new ServerSentEvents(req, res);
      await sse.send({ data: 'this is my\nmultiline message', id: '123' });
      await sse.close();
    });

    return withServer(handler, async (url) => {
      const res = await rawRequest(url);
      expect(res).contains('id:123\ndata:this is my\ndata:multiline message\n\n');
    });
  });

  it('sends newlines as they appeared', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      const sse = new ServerSentEvents(req, res);
      await sse.send({ data: 'one\ntwo\rthree\r\nfour\r\n\r\n\r' });
      await sse.close();
    });

    return withServer(handler, async (url) => {
      const res = await rawRequest(url);
      expect(res).contains(
        'data:one\ndata:two\rdata:three\r\ndata:four\r\ndata:\r\ndata:\rdata:\n\n',
      );
    });
  });

  it('sends pings as a tiny comment in its own chunk', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      const sse = new ServerSentEvents(req, res);
      await sse.send({ data: 'one' });
      sse.ping();
      await sse.send({ data: 'two' });
      await sse.close();
    });

    return withServer(handler, async (url) => {
      const res = await rawRequest(url);
      expect(res).endsWith('data:one\n\n\r\n3\r\n:\n\n\r\na\r\ndata:two\n\n\r\n0\r\n\r\n');
    });
  });

  it('sends pings automatically to keep the connection alive', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      const sse = new ServerSentEvents(req, res, { keepaliveInterval: 50 });
      await sse.send({ data: 'one' });
      await new Promise((resolve) => setTimeout(resolve, 80)); // should send 1 keepalive
      await sse.send({ data: 'two' });
      await new Promise((resolve) => setTimeout(resolve, 30)); // should send no keepalive (interval is reset)
      await sse.send({ data: 'three' });
      await sse.close();
    });

    return withServer(handler, async (url) => {
      const res = await rawRequest(url);
      const pingPacket = '3\r\n:\n\n\r\n';
      const closePacket = '0\r\n\r\n';
      expect(res).contains(
        'data:one\n\n\r\n' +
          pingPacket +
          'a\r\ndata:two\n\n\r\n' +
          'c\r\ndata:three\n\n\r\n' +
          closePacket,
      );
    });
  });

  it('allows all characters', { timeout: 3000 }, () => {
    const makeEntry = (i: number) => `${i}: ${String.fromCodePoint(i)}.`;
    const handler = requestHandler(async (req, res) => {
      const sse = new ServerSentEvents(req, res);
      for (let i = 0; i < 256; ++i) {
        await sse.send({ data: makeEntry(i) });
      }
    });

    return withEventSource(handler, async ({ queue }) => {
      for (let i = 0; i < 256; ++i) {
        if (i === 13) {
          expect((await queue.shift()).data).equals('13: \n.'); // all line endings, including \r, get converted to \n by the receiver according to the spec
        } else {
          expect((await queue.shift()).data).equals(makeEntry(i));
        }
      }
    });
  });

  it('closes the connection cleanly when soft close is triggered', { timeout: 3000 }, () => {
    const handler = requestHandler(async (req, res) => {
      const sse = new ServerSentEvents(req, res);
      await sse.send({ data: 'welcome' });
    });

    return withServer(handler, async (url, { listeners }) => {
      const socket = await rawRequestStream(url);

      const received = makeStreamSearch(socket, fail);

      await received.find('data:welcome');
      expect(received).not(contains('retry:'));
      listeners.softClose('shutdown', (err) => fail(String(err)));
      await received.expectEnd();
      expect(received.current()).matches(/retry:\d+\n\n\r\n0\r\n\r\n$/);
    });
  });
});

function withEventSource(
  handler: Handler,
  test: (props: { source: EventSource; queue: BlockingQueue<MessageEvent<any>> }) => Promise<void>,
) {
  return withServer(handler, async (url) => {
    const { source, queue } = queueEventSource(url);
    try {
      await test({ source, queue });
    } finally {
      source.close();
      while (source.readyState !== EventSource.CLOSED) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    }
  });
}

function queueEventSource(url: string) {
  const queue = new BlockingQueue<MessageEvent<any>>();
  const source = new EventSource(url);
  source.addEventListener('message', (ev) => {
    queue.push(ev);
  });
  return { source, queue };
}
