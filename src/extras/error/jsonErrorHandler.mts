import type { IncomingMessage } from 'node:http';
import { findCause } from '../../util/findCause.mts';
import { HTTPError } from '../../core/HTTPError.mts';
import type { ErrorHandler } from '../../core/handler.mts';
import { getResponse } from '../../core/defaultErrorHandler.mts';
import { readHTTPQualityValues } from '../request/headers.mts';
import { emitError } from './emitError.mts';

export interface JSONErrorHandlerOptions {
  /**
   * Only send a JSON response if the client sent `Accept: application/json`.
   * @default true
   */
  onlyIfRequested?: boolean | undefined;

  /**
   * Emit the error to the current error listener.
   * @default true
   */
  emitError?: boolean | undefined;

  /**
   * If set, forces a consistent HTTP status code (ignoring the status code from the error).
   * @default undefined
   */
  forceStatus?: number | undefined;

  /**
   * The content-type to set on the response.
   * @default 'application/json'
   */
  contentType?: string;
}

export const jsonErrorHandler = (
  conversion: (error: HTTPError) => unknown,
  {
    onlyIfRequested = true,
    emitError: doEmitError = true,
    forceStatus,
    contentType = 'application/json',
  }: JSONErrorHandlerOptions = {},
): ErrorHandler => ({
  handleError: (error, req, output) => {
    if (output.hasUpgraded || (onlyIfRequested && !checkAccepted(req, contentType))) {
      throw error;
    }
    if (doEmitError) {
      emitError(req, error);
    }
    const res = getResponse(output);
    if (!res) {
      return;
    }
    const httpError = findCause(error, HTTPError) ?? new HTTPError(500);
    const encoded = JSON.stringify(conversion(httpError));
    res.setHeaders(httpError.headers);
    res.setHeader('content-type', contentType);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-length', String(Buffer.byteLength(encoded, 'utf-8')));
    if (!output.response) {
      res.setHeader('connection', 'close');
    }
    if (forceStatus) {
      res.writeHead(forceStatus);
    } else {
      res.writeHead(httpError.statusCode, httpError.statusMessage);
    }
    res.end(encoded, 'utf-8');
  },
  shouldHandleError: (_, req, output) =>
    !output.hasUpgraded && (!onlyIfRequested || checkAccepted(req, contentType)),
});

const checkAccepted = (req: IncomingMessage, ct: string) =>
  readHTTPQualityValues(req.headers['accept'])?.some(
    (o) => o.name === ct || o.name === 'application/json',
  ) ?? false;
