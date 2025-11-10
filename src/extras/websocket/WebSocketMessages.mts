import { BlockingQueue } from '../../util/BlockingQueue.mts';
import { WebSocketError } from './WebSocketError.mts';

type MessageHandler = ((data: string | Buffer) => void) &
  ((data: Buffer, isBinary: boolean) => void);
type CloseHandler = () => void;

export interface ListenableWebSocket {
  on(event: 'message', handler: MessageHandler): void;
  on(event: 'close', handler: CloseHandler): void;
  off(event: 'message', handler: MessageHandler): void;
  off(event: 'close', handler: CloseHandler): void;
  readyState?: number;
}

export class WebSocketMessage {
  declare public readonly data: Buffer;
  declare public readonly isBinary: boolean;

  constructor(data: Buffer, isBinary: boolean) {
    this.data = data;
    this.isBinary = isBinary;
  }

  get text() {
    if (this.isBinary) {
      throw new WebSocketError(WebSocketError.UNSUPPORTED_DATA, { statusMessage: 'expected text' });
    }
    return this.data.toString('utf-8');
  }

  get binary() {
    if (!this.isBinary) {
      throw new WebSocketError(WebSocketError.UNSUPPORTED_DATA, {
        statusMessage: 'expected binary',
      });
    }
    return this.data;
  }
}

interface WebSocketMessagesOptions {
  limit?: number;
  signal?: AbortSignal | undefined;
}

export class WebSocketMessages implements AsyncIterable<WebSocketMessage, unknown, undefined> {
  /** @internal */ declare private readonly _queue: BlockingQueue<WebSocketMessage>;
  declare public readonly detach: () => void;

  constructor(ws: ListenableWebSocket, { limit = -1, signal }: WebSocketMessagesOptions = {}) {
    this._queue = new BlockingQueue<WebSocketMessage>();
    const detach = (message: string) => {
      ws.off('message', handleMessage);
      ws.off('close', close);
      this._queue.close(new Error(message));
    };
    const close = () => detach('connection closed');
    const handleMessage = (data: Buffer | string, isBinary?: boolean) => {
      if (isBinary !== undefined) {
        // ws 8.x
        this._queue.push(new WebSocketMessage(data as Buffer, isBinary));
      } else if (typeof data === 'string') {
        // ws 7.x
        this._queue.push(new WebSocketMessage(Buffer.from(data, 'utf-8'), false));
      } else {
        this._queue.push(new WebSocketMessage(data, true));
      }
      if (limit > 0) {
        --limit;
        if (limit === 0) {
          this.detach();
        }
      }
    };
    this.detach = () => {};
    if (signal?.aborted) {
      this._queue.close(new Error('signal aborted'));
    } else if (ws.readyState === 2 || ws.readyState === 3) {
      this._queue.close(new Error('connection closed'));
    } else {
      ws.on('message', handleMessage);
      ws.on('close', close);
      signal?.addEventListener('abort', () => detach('signal aborted'));
      this.detach = () => detach('WebSocket listener detached');
    }
  }

  next(timeout?: number): Promise<WebSocketMessage> {
    return this._queue.shift(timeout);
  }

  [Symbol.asyncIterator]() {
    return this._queue[Symbol.asyncIterator]();
  }
}

export function nextWebSocketMessage(
  ws: ListenableWebSocket,
  { timeout, signal }: { timeout?: number; signal?: AbortSignal } = {},
): Promise<WebSocketMessage> {
  const messages = new WebSocketMessages(ws, { limit: 1, signal });
  return messages.next(timeout).finally(() => messages.detach());
}
