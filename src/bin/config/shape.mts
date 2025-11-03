import type {
  ProxyOptions,
  FileServerOptions,
  FileNegotiation,
  CombinedServerOptions,
  FileNegotiationOption,
} from '../../index.mts';
import {
  bool,
  choice,
  int,
  list,
  lit,
  maybeList,
  num,
  obj,
  opt,
  or,
  record,
  str,
  type Mapper,
  type Type,
} from './types.mts';

const configFileNegotiationOption = obj({
  match: str,
  as: opt(str, undefined),
  file: str,
}) satisfies Mapper<FileNegotiationOption>;
export type ConfigFileNegotiationOption = Type<typeof configFileNegotiationOption>;

const configFileNegotiation = obj({
  type: choice('mime', 'language', 'encoding'),
  options: list(configFileNegotiationOption),
}) satisfies Mapper<FileNegotiation>;

const configMountFilesOptions = obj({
  mode: opt(choice('dynamic', 'static-paths'), 'dynamic'),
  fallback: opt(
    obj({
      statusCode: opt(int, 200),
      filePath: str,
    }),
    undefined,
  ),
  subDirectories: opt(or(bool, int), true),
  caseSensitive: opt(choice('exact', 'filesystem', 'force-lowercase'), 'exact'),
  allowAllDotfiles: opt(bool, false),
  allowAllTildefiles: opt(bool, false),
  allowDirectIndexAccess: opt(bool, false),
  hide: opt(list(str), () => []),
  allow: opt(list(str), () => ['.well-known']),
  indexFiles: opt(list(str), () => ['index.htm', 'index.html']),
  negotiation: opt(list(configFileNegotiation), () => []),
}) satisfies Mapper<FileServerOptions>;

const configMountFiles = obj({
  type: lit('files' as const),
  path: opt(str, '/'),
  dir: opt(str, '.'),
  options: opt(configMountFilesOptions, () => configMountFilesOptions({})),
});

const configMountProxyOptions = obj({
  noDelay: opt(bool, undefined),
  keepAlive: opt(bool, undefined),
  keepAliveInitialDelay: opt(num, undefined),
  keepAliveMsecs: opt(num, undefined),
  agentKeepAliveTimeoutBuffer: opt(num, undefined),
  maxSockets: opt(int, undefined),
  maxFreeSockets: opt(int, undefined),
  timeout: opt(int, undefined),
  blockRequestHeaders: opt(list(str), undefined),
  blockResponseHeaders: opt(list(str), undefined),

  // https only
  servername: opt(str, undefined),
  ca: opt(str, undefined),
  cert: opt(str, undefined),
  sigalgs: opt(str, undefined),
  ciphers: opt(str, undefined),
  crl: opt(str, undefined),
  ecdhCurve: opt(str, undefined),
  key: opt(str, undefined),
  passphrase: opt(str, undefined),
  pfx: opt(str, undefined),
  sessionTimeout: opt(num, undefined),
  maxCachedSessions: opt(num, undefined),
}) satisfies Mapper<ProxyOptions>;

const configMountProxy = obj({
  type: lit('proxy' as const),
  path: opt(str, '/'),
  target: str,
  options: opt(configMountProxyOptions, () => configMountProxyOptions({})),
});

const configMountFixture = obj({
  type: lit('fixture' as const),
  path: str,
  method: opt(str, 'GET'),
  status: opt(int, 200),
  headers: opt(record(or(str, num, list(str))), () => ({})),
  body: str,
});

export const configMount = or(configMountFiles, configMountProxy, configMountFixture);
export type ConfigMount = Type<typeof configMount>;

export const configServerOptions = obj({
  requestTimeout: opt(num, undefined),
  keepAliveTimeout: opt(num, undefined),
  keepAliveTimeoutBuffer: opt(num, undefined),
  connectionsCheckingInterval: opt(num, undefined),
  headersTimeout: opt(num, undefined),
  highWaterMark: opt(num, undefined),
  maxHeaderSize: opt(num, undefined),
  noDelay: opt(bool, undefined),
  requireHostHeader: opt(bool, undefined),
  keepAlive: opt(bool, undefined),
  keepAliveInitialDelay: opt(num, undefined),
  uniqueHeaders: opt(list(str), undefined),
  backlog: opt(num, 511),
  socketTimeout: opt(num, undefined),
  rejectNonStandardExpect: opt(bool, false),
  autoContinue: opt(bool, false),
  logRequests: opt(bool, true),
  restartTimeout: opt(num, 2000),
  shutdownTimeout: opt(num, 500),
}) satisfies Mapper<
  CombinedServerOptions & {
    logRequests: boolean;
    restartTimeout: number;
    shutdownTimeout: number;
  }
>;
export type ConfigServerOptions = Type<typeof configServerOptions>;

export const configServer = obj({
  port: int,
  host: opt(str, 'localhost'),
  options: opt(configServerOptions, () => configServerOptions({})),
  mount: list(configMount),
});
export type ConfigServer = Type<typeof configServer>;

export const config = obj({
  servers: list(configServer),
  mime: maybeList(or(str, record(str))),
});
export type Config = Type<typeof config>;
