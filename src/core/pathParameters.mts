import type { IncomingMessage } from 'node:http';
import { internalGetProps, type MessageProps } from './messages.mts';

const PATH_PARAMETERS = Symbol();
export type WithPathParameters<PathParameters> = { [PATH_PARAMETERS]: PathParameters };
export type WithoutPathParameters = { [PATH_PARAMETERS]?: { [k in PropertyKey]?: never } };

const EMPTY = Object.freeze({});

interface PathParametersProps {
  _pathParams: Readonly<Record<string, unknown>>;
}

export function internalBeginPathScope(
  props: MessageProps & Partial<PathParametersProps>,
  scopedPathname: string,
  scopedPathParameters: [string, unknown][],
) {
  const oldURL = props._request.url;
  const oldPathname = props._decodedPathname;
  const oldPathParameters = props._pathParams ?? EMPTY;

  // re-encode the scoped path so that native handlers (which expect to have to decode it themselves) work without modification
  props._request.url =
    encodeURIComponent(scopedPathname).replaceAll(/%2F/g, '/') + props._originalURL.search;
  props._decodedPathname = scopedPathname;
  if (scopedPathParameters.length > 0) {
    props._pathParams = Object.freeze(
      Object.fromEntries([...Object.entries(oldPathParameters), ...scopedPathParameters]),
    );
  }

  return () => {
    props._request.url = oldURL;
    props._decodedPathname = oldPathname;
    props._pathParams = oldPathParameters;
  };
}

export function getPathParameters<PathParameters extends {}>(
  req: IncomingMessage & WithPathParameters<PathParameters>,
): Readonly<PathParameters> {
  return (internalGetProps<PathParametersProps>(req)?._pathParams ??
    EMPTY) as Readonly<PathParameters>;
}

export const getPathParameter = <PathParameters extends {}, ID extends keyof PathParameters>(
  req: IncomingMessage & WithPathParameters<PathParameters>,
  id: ID,
) => getPathParameters(req)[id];

export function getAbsolutePath(req: IncomingMessage) {
  const props = internalGetProps(req);
  if (props) {
    return props._originalURL.pathname + props._originalURL.search;
  } else {
    return req.url ?? '/';
  }
}

export function restoreAbsolutePath(req: IncomingMessage) {
  const props = internalGetProps(req);
  if (props) {
    req.url = props._originalURL.pathname + props._originalURL.search;
  }
}
