import { BlockingQueue } from '../util/BlockingQueue.mts';

export function makeWebSocketConnection(url: string) {
  const received = new BlockingQueue<string>();
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => received.push('OPEN'));
  ws.addEventListener('message', (ev) => received.push(`MESSAGE: ${ev.data}`));
  ws.addEventListener('close', (ev) => {
    received.push(`CLOSED: ${ev.code} ${ev.reason}`);
    received.close(`connection closed ${ev.code} ${ev.reason}`);
  });
  return {
    ws,
    next: () => received.shift(500),
    closed: async () => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (ws.readyState === WebSocket.CLOSED) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      throw new Error('websocket did not close within the time limit');
    },
  };
}
