import type { IncomingMessage } from 'node:http';
import { accessProperty } from '../util/safeAccess.mts';
import { posEncoded } from '../util/parseURL.mts';
import { internalGetProps, type MessageProps } from './messages.mts';

const PATH_PARAMETERS = Symbol();
export type WithPathParameters<PathParameters> = {} extends PathParameters
  ? { [PATH_PARAMETERS]?: PathParameters }
  : { [PATH_PARAMETERS]: PathParameters };

const EMPTY = Object.freeze({});

interface PathParametersProps {
  _pathParams: Readonly<Record<string, unknown>>;
}

export function internalBeginPathScope(
  props: MessageProps & Partial<PathParametersProps>,
  pathRest: string,
  scopedPathParameters: [string, unknown][],
) {
  const oldURL = props._request.url;
  const oldDecodedPathname = props._decodedPathname;
  const oldEncodedPathname = props._encodedPathname;
  const oldPathParameters = props._pathParams ?? EMPTY;

  props._decodedPathname = `/${pathRest}`;
  let newURL: string;
  let newEncodedPathname: string | undefined;
  if (props._encodedPathname && pathRest) {
    // re-encode the scoped path so that native handlers (which expect to have to decode it themselves) work without modification
    const cut = posEncoded(props._encodedPathname, oldDecodedPathname.length - pathRest.length);
    newEncodedPathname = '/' + props._encodedPathname.substring(cut);
    newURL = newEncodedPathname;
  } else {
    newURL = props._decodedPathname;
  }
  props._request.url = newURL + props._originalURL.search;
  props._encodedPathname = newEncodedPathname?.includes('%') ? newEncodedPathname : undefined;
  if (scopedPathParameters.length > 0) {
    props._pathParams = Object.freeze(
      Object.fromEntries([...Object.entries(oldPathParameters), ...scopedPathParameters]),
    );
  }

  return () => {
    props._request.url = oldURL;
    props._decodedPathname = oldDecodedPathname;
    if (oldEncodedPathname) {
      props._encodedPathname = oldEncodedPathname;
    }
    props._pathParams = oldPathParameters;
  };
}

export function getPathParameters<PathParameters extends {}>(
  req: IncomingMessage & WithPathParameters<PathParameters>,
): Readonly<PathParameters> {
  return (internalGetProps<PathParametersProps>(req)?._pathParams ??
    EMPTY) as Readonly<PathParameters>;
}

export function getPathParameter<PathParameters extends {}, ID extends keyof PathParameters>(
  req: IncomingMessage & WithPathParameters<PathParameters>,
  id: ID,
): PathParameters[ID];

export function getPathParameter<PathParameters, ID extends string>(
  req: IncomingMessage & WithPathParameters<PathParameters>,
  id: ID,
): keyof PathParameters extends ID ? string | string[] | undefined : undefined;

export function getPathParameter<PathParameters extends {}, ID extends keyof PathParameters>(
  req: IncomingMessage & WithPathParameters<PathParameters>,
  id: ID,
) {
  return accessProperty(getPathParameters(req), id);
}

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
