import type { IncomingMessage } from 'node:http';
import { CONTINUE } from '../../core/RoutingInstruction.mts';
import type { MaybePromise } from '../../util/MaybePromise.mts';
import { scheduleClose } from '../../core/close.mts';
import { anyHandler, type RequestHandler, type UpgradeHandler } from '../../core/handler.mts';
import { HTTPError } from '../../core/HTTPError.mts';
import type { ServerErrorCallback } from '../../core/errorHandler.mts';
import { getAuthorization } from '../request/headers.mts';
import { makeProperty, internalAsFactory } from '../properties.mts';

interface BearerAuthOptions<Req, Token> {
  realm: string | ((req: IncomingMessage & Req) => MaybePromise<string>);
  extractAndValidateToken: (
    token: string,
    realm: string,
    req: IncomingMessage & Req,
  ) => MaybePromise<Token>;
  fallbackTokenFetcher?: (req: IncomingMessage & Req) => MaybePromise<string | undefined>;
  closeOnExpiry?: boolean;
  softCloseBufferTime?: number;
  onSoftCloseError?: ServerErrorCallback;
}

interface JWTToken {
  nbf?: number;
  exp?: number;
  scopes?: Record<string, boolean> | string[] | string;
}

export function requireBearerAuth<Req = {}, Token = JWTToken>({
  realm,
  extractAndValidateToken,
  fallbackTokenFetcher,
  closeOnExpiry = true,
  softCloseBufferTime = 0,
  onSoftCloseError,
}: BearerAuthOptions<Req, Token>): RequestHandler<Req> & UpgradeHandler<Req> {
  const realmForRequest = internalAsFactory(realm);

  return anyHandler(async (req) => {
    const now = Date.now();
    const authRealm = await realmForRequest(req);
    const failHeaders = { 'www-authenticate': `Bearer realm="${authRealm}"` };
    const auth = getAuthorization(req);
    const token = auth?.[0] === 'bearer' ? auth[1] : await fallbackTokenFetcher?.(req);
    if (!token) {
      throw new HTTPError(401, { headers: failHeaders, body: 'no token provided' });
    }

    const tokenData = await extractAndValidateToken(token, authRealm, req);
    if (!tokenData) {
      throw new HTTPError(401, { headers: failHeaders, body: 'invalid token' });
    }

    if (typeof tokenData === 'object') {
      if ('nbf' in tokenData && typeof tokenData.nbf === 'number' && now < tokenData.nbf * 1000) {
        throw new HTTPError(401, { headers: failHeaders, body: 'token not valid yet' });
      }

      if ('exp' in tokenData && typeof tokenData.exp === 'number') {
        const exp = tokenData.exp * 1000;
        if (now >= exp - softCloseBufferTime) {
          throw new HTTPError(401, { headers: failHeaders, body: 'token expired' });
        } else if (closeOnExpiry) {
          scheduleClose(req, 'token expired', exp, softCloseBufferTime, onSoftCloseError);
        }
      }
    }

    AUTH.set(req, {
      realm: authRealm,
      data: tokenData,
      scopes: internalExtractScopesMap(tokenData),
    });
    return CONTINUE;
  });
}

export const getAuthData = <Token,>(req: IncomingMessage) => AUTH.get(req).data as Token | null;
export const hasAuthScope = (req: IncomingMessage, scope: string) =>
  AUTH.get(req).scopes.has(scope);

export const requireAuthScope = (scope: string): RequestHandler & UpgradeHandler =>
  anyHandler((req) => {
    const data = AUTH.get(req);
    if (!data.scopes.has(scope)) {
      throw new HTTPError(403, {
        headers: { 'www-authenticate': `Bearer realm="${data.realm}", scope="${scope}"` },
        body: `scope required: ${scope}`,
      });
    }
    return CONTINUE;
  });

const AUTH = /*@__PURE__*/ makeProperty({
  realm: '',
  data: null as unknown,
  scopes: new Set<string>(),
});

function internalExtractScopesMap(data: unknown): Set<string> {
  if (!data || typeof data !== 'object' || !('scopes' in data)) {
    return new Set();
  }
  const { scopes } = data;
  if (Array.isArray(scopes)) {
    return new Set(scopes);
  }
  if (typeof scopes === 'string') {
    return new Set([scopes]);
  }
  if (scopes && typeof scopes === 'object') {
    return new Set(
      Object.entries(scopes)
        .filter(([_, v]) => v)
        .map(([k]) => k),
    );
  }
  return new Set();
}
