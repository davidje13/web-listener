import type { IncomingMessage } from 'node:http';
import { internalParseURL } from '../util/parseURL.mts';
import { internalGetProps } from './messages.mts';

const internalGetURL = (req: IncomingMessage) =>
  internalGetProps(req)?._originalURL ?? internalParseURL(req);

/** get the query string for the URL (including the leading '?' if it is set) */
export const getSearch = (req: IncomingMessage) => internalGetURL(req).search;

/** get the query string for the URL as a URLSearchParams object */
export const getSearchParams = (req: IncomingMessage) =>
  new URLSearchParams(internalGetURL(req).searchParams); // make a copy to prevent mutating the shared value

/** get a specific query parameter from the URL */
export const getQuery = (req: IncomingMessage, id: string) =>
  internalGetURL(req).searchParams.get(id);
