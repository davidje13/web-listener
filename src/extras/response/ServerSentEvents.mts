import type { IncomingMessage, ServerResponse } from 'node:http';
import { setSoftCloseHandler } from '../../core/close.mts';

interface ServerSentEventsOptions {
  keepaliveInterval?: number;
  softCloseReconnectDelay?: number;
  softCloseReconnectStagger?: number;
}

export interface ServerSentEvent {
  event?: string;
  data?: string;
  id?: string;
  reconnectDelay?: number;
}

export class ServerSentEvents {
  /** @internal */ private readonly _res: ServerResponse;
  /** @internal */ private readonly _ac: AbortController;
  /** @internal */ private _keepaliveInterval: number;
  /** @internal */ private _keepalive: NodeJS.Timeout | undefined;

  constructor(
    req: IncomingMessage,
    res: ServerResponse,
    {
      keepaliveInterval = 15000,
      softCloseReconnectDelay = 500,
      softCloseReconnectStagger = 2000,
    }: ServerSentEventsOptions = {},
  ) {
    this._res = res;
    this._keepaliveInterval = keepaliveInterval ?? 0;
    this._ac = new AbortController();

    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('x-accel-buffering', 'no'); // disable buffering in reverse proxies
    res.setHeader('cache-control', 'no-store');
    res.writeHead(200);
    res.flushHeaders();

    this.ping = this.ping.bind(this);
    this._startKeepalive();
    req.once('close', () => this.close());
    setSoftCloseHandler(req, () => this.close(softCloseReconnectDelay, softCloseReconnectStagger));
  }

  get signal() {
    return this._ac.signal;
  }

  get open() {
    return !this._ac.signal.aborted;
  }

  /** @internal */
  private _startKeepalive() {
    if (this._keepaliveInterval) {
      this._keepalive = setTimeout(this.ping, this._keepaliveInterval);
    }
  }

  ping() {
    if (!this._ac.signal.aborted && this._res.writable) {
      clearTimeout(this._keepalive);
      this._res.write(':\n\n', () => this._startKeepalive());
    }
  }

  send({ event, id, data, reconnectDelay = -1 }: ServerSentEvent) {
    return this.sendFields([
      ['event', event],
      ['id', id],
      ['data', data],
      ['retry', reconnectDelay >= 0 ? String(reconnectDelay | 0) : undefined],
    ]);
  }

  async sendFields(parts: [string, string | undefined][]): Promise<void> {
    if (this._ac.signal.aborted) {
      throw new Error('ServerSentEvents closed');
    }
    let done: () => void;
    this._res.cork();
    try {
      let any = false;
      for (const [key, value] of parts) {
        if (value === undefined) {
          continue;
        }
        const lines = value.split(/(?<=\n)|(?<=\r)(?!\n)/g);
        for (let line of lines) {
          this._res.write(key);
          if (line[0] === ' ') {
            // a single space after the : is ignored by the client, so we must
            // add an extra space if the line actually begins with a space.
            this._res.write(': ');
          } else {
            // otherwise we can skip the space to reduce the size
            this._res.write(':');
          }
          this._res.write(line);
        }
        if (/[\r\n]$/.test(value)) {
          this._res.write(key);
          this._res.write(':\n');
        } else {
          this._res.write('\n');
        }
        any = true;
      }
      if (!any) {
        return;
      }
      clearTimeout(this._keepalive);
      this._res.write('\n', () => done());
    } finally {
      this._res.uncork();
    }
    await new Promise<void>((resolve) => {
      done = resolve;
    });
    this._startKeepalive();
  }

  async close(reconnectDelay = 0, reconnectStagger = 0) {
    if (this._ac.signal.aborted) {
      if (this._res.closed) {
        return;
      }
      return new Promise<void>((resolve) => this._res.once('close', resolve));
    }
    this._keepaliveInterval = 0;
    clearTimeout(this._keepalive);
    this._ac.abort();
    await new Promise<void>((resolve) => {
      if (this._res.writable && (reconnectDelay > 0 || reconnectStagger > 0)) {
        const delay = reconnectDelay + Math.random() * reconnectStagger;
        this._res.end(`retry:${delay | 0}\n\n`, resolve);
      } else {
        this._res.end(resolve);
      }
    });
  }
}
