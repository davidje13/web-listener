import type { IncomingMessage } from 'node:http';
import { internalParseURL } from '../util/parseURL.mts';
import { internalGetProps } from './messages.mts';

const internalGetURL = (req: IncomingMessage) =>
  internalGetProps(req)?._originalURL ?? internalParseURL(req);

export const getSearch = (req: IncomingMessage) => internalGetURL(req).search;
export const getSearchParams = (req: IncomingMessage) =>
  new URLSearchParams(internalGetURL(req).searchParams); // make a copy to prevent mutating the shared value
export const getQuery = (req: IncomingMessage, id: string) =>
  internalGetURL(req).searchParams.get(id);
