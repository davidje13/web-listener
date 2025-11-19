import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

// This type is defined inline in node:http's Server.addListener('clientError', ...) definition
export type ClientErrorListener = (error: Error, socket: Duplex) => void;

// This type is defined inline in node:http's Server.addListener('upgrade', ...) definition
export type UpgradeListener = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

// This type is defined inline in node:http's ServerOptions definition
export type ShouldUpgradeCallback = (req: IncomingMessage) => boolean;

/** @internal */
declare module 'node:http' {
  interface Server {
    // this property is exposed as getable/setable, but is not documented or listed in @node/types
    shouldUpgradeCallback?: ShouldUpgradeCallback;
  }
}
