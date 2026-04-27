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
  scopedPathname: string,
  scopedPathParameters: [string, unknown][],
) {
  const oldURL = props._request.url;
  const oldDecodedPathname = props._decodedPathname;
  const oldEncodedPathname = props._encodedPathname;
  const oldPathParameters = props._pathParams ?? EMPTY;

  if (props._encodedPathname) {
    // re-encode the scoped path so that native handlers (which expect to have to decode it themselves) work without modification
    const cut = posEncoded(
      props._encodedPathname,
      props._decodedPathname.length - scopedPathname.length,
    );
    const newEncodedPathname = props._encodedPathname.substring(cut);
    props._request.url = newEncodedPathname + props._originalURL.search;
    props._encodedPathname = newEncodedPathname.includes('%') ? newEncodedPathname : undefined;
  } else {
    props._request.url = scopedPathname + props._originalURL.search;
  }
  props._decodedPathname = scopedPathname;
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
