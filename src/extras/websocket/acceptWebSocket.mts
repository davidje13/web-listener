import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { acceptUpgrade, type AcceptUpgradeHandler } from '../../core/acceptUpgrade.mts';
import { HTTPError } from '../../core/HTTPError.mts';
import { findCause } from '../../util/findCause.mts';
import { WebSocketError } from './WebSocketError.mts';

interface InternalWebSocketServerOptions {
  noServer?: true;
  clientTracking?: false;
  WebSocket?: any;
}

type ForbiddenWebSocketServerOptions =
  | 'backlog'
  | 'server'
  | 'noServer'
  | 'clientTracking'
  | 'host'
  | 'port'
  | 'path'
  | 'verifyClient';

declare class WebSocketServer<T, Options> {
  constructor(options: Options);

  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (ws: T) => void,
  ): void;

  once(event: 'wsClientError', handler: (error: Error) => void): void;
  off(event: 'wsClientError', handler: (error: Error) => void): void;
}

interface ClosableWebSocket {
  close(status: number, message?: string): void;
}

interface WebSocketOptions {
  softCloseStatusCode?: number | undefined;
}

export function makeAcceptWebSocket<T extends ClosableWebSocket, PassThroughOptions>(
  wsServerClass: typeof WebSocketServer<T, InternalWebSocketServerOptions & PassThroughOptions>,
  {
    softCloseStatusCode = WebSocketError.GOING_AWAY,
    ...options
  }: Partial<PassThroughOptions & Record<ForbiddenWebSocketServerOptions, never>> & {
    WebSocket?: (new (...args: any) => T) | undefined;
  } & WebSocketOptions = {},
): (req: IncomingMessage) => Promise<T> {
  const upgrader: AcceptUpgradeHandler<T> = (req, socket, head) =>
    new Promise((resolve, reject) => {
      const wsServer = new wsServerClass({
        ...options,
        noServer: true,
        clientTracking: false,
      });
      wsServer.once('wsClientError', reject);
      wsServer.handleUpgrade(req, socket, head, (ws) => {
        wsServer.off('wsClientError', reject);
        resolve({
          return: ws,
          onError: (error) => {
            const wsError = findCause(error, WebSocketError);
            if (wsError) {
              ws.close(wsError.statusCode, wsError.statusMessage);
              return;
            }
            const httpError = findCause(error, HTTPError) ?? new HTTPError(500);
            const wsStatus =
              httpError.statusCode >= 500
                ? WebSocketError.INTERNAL_SERVER_ERROR
                : 4000 + httpError.statusCode;
            ws.close(wsStatus, httpError.statusMessage);
          },
          softCloseHandler: (reason) => ws.close(softCloseStatusCode, reason),
        });
      });
    });

  return (req) => acceptUpgrade(req, upgrader);
}
