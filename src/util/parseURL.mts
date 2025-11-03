import type { IncomingMessage } from 'node:http';

export const internalParseURL = (req: IncomingMessage) =>
  new URL('http://localhost' + (req.url ?? '/'));
