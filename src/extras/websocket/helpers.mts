import type { IncomingMessage } from 'node:http';
import { internalNormaliseHeaderValue } from '../../polyfill/SocketServerResponse.mts';
import { internalMustGetProps } from '../../core/messages.mts';
import { STOP } from '../../core/RoutingInstruction.mts';
import {
  nextWebSocketMessage,
  type ListenableWebSocket,
  type WebSocketMessage,
} from './WebSocketMessages.mts';
import { WebSocketError } from './WebSocketError.mts';

export function isWebSocketRequest(req: IncomingMessage): boolean {
  const props = internalMustGetProps(req);
  if (req.method !== 'GET') {
    return false;
  }
  return props._upgradeProtocols?.has('websocket') ?? false;
}

export const getWebSocketOrigin = (req: IncomingMessage): string | undefined =>
  req.headers['origin'] ?? internalNormaliseHeaderValue(req.headers['sec-websocket-origin']);

/**
 * Factory for a fallback authentication token fetcher for websockets. Browsers do not allow setting the
 * Authorization header when creating a websocket, so this allows the token to be sent as the first message
 * instead.
 *
 * @param acceptWebSocket a function for accepting a websocket (e.g. `makeAcceptWebSocket(WebSocketServer)`)
 * @returns a function suitable for use with `requireBearerAuth`'s `fallbackTokenFetcher` option.
 */
export const makeWebSocketFallbackTokenFetcher =
  <Req,>(
    acceptWebSocket: (req: IncomingMessage & Req) => Promise<ListenableWebSocket>,
    timeout = 5000,
  ) =>
  async (req: IncomingMessage & Req): Promise<string | undefined> => {
    if (!isWebSocketRequest(req)) {
      return undefined;
    }
    const ws = await acceptWebSocket(req);
    let tokenMessage: WebSocketMessage;
    try {
      tokenMessage = await nextWebSocketMessage(ws, { timeout });
    } catch (error: unknown) {
      if ((ws.readyState ?? 0) >= 2) {
        throw STOP;
      }
      throw new WebSocketError(WebSocketError.POLICY_VIOLATION, {
        statusMessage: 'timeout waiting for authentication token',
        cause: error,
      });
    }
    if (tokenMessage.isBinary) {
      throw new WebSocketError(WebSocketError.UNSUPPORTED_DATA, {
        statusMessage: 'authentication token must be sent as text',
      });
    }
    return tokenMessage.data.toString('utf-8');
  };
