import type {
  ProxyOptions,
  FileServerOptions,
  CombinedServerOptions,
  FileNegotiation,
} from '../../index.mts';
import type { DependencyHandlerOptions } from '../routes/modules/dependencies.mts';
import type { LogLevel } from '../log.mts';

export type ConfigHeaders = Record<string, string | number | string[]>;

export type ConfigMountFilesOptions = Omit<FileServerOptions, 'negotiator'> & {
  negotiation?: FileNegotiation[] | undefined;
  headers?: ConfigHeaders | undefined;
};

interface ConfigMountDelegate {
  type: 'delegate';
  path: string;
  config: ConfigServerRef;
}

interface ConfigMountNested {
  type: 'nested';
  path: string;
  mount: ConfigMount[];
}

interface ConfigMountHeaders {
  type: 'headers';
  path: string;
  headers: ConfigHeaders;
}

interface ConfigMountFiles {
  type: 'files';
  path: string;
  dir: string;
  options: ConfigMountFilesOptions;
}

interface ConfigMountProxy {
  type: 'proxy';
  path: string;
  target: string;
  options: ProxyOptions & {
    headers?: ConfigHeaders | undefined;
  };
}

interface ConfigMountFixture {
  type: 'fixture';
  path: string;
  method: string;
  status: number;
  headers: ConfigHeaders;
  body: string;
}

interface ConfigMountRedirect {
  type: 'redirect';
  path: string;
  status: number;
  target: string;
}

interface ConfigMountRedirectMap {
  type: 'redirect-map';
  mapping: string | Record<string, string>;
  status: number;
  options: {
    caseSensitive: boolean;
  };
}

interface ConfigMountDependencies {
  type: 'dependencies';
  path: string;
  package: string;
  options: Omit<DependencyHandlerOptions, 'negotiator' | 'fallback'> & {
    headers?: ConfigHeaders | undefined;
  };
}

interface ConfigMountCustom {
  type: 'custom';
  path: string;
  method: string | string[] | null;
  import: string;
}

export type ConfigMount =
  | ConfigMountDelegate
  | ConfigMountNested
  | ConfigMountHeaders
  | ConfigMountFiles
  | ConfigMountProxy
  | ConfigMountFixture
  | ConfigMountRedirect
  | ConfigMountRedirectMap
  | ConfigMountDependencies
  | ConfigMountCustom;

export interface ConfigServerOptions extends CombinedServerOptions {
  logRequests: boolean;
  restartTimeout: number;
  shutdownTimeout: number;
}

export interface ConfigServer {
  port: number;
  host: string;
  options: ConfigServerOptions;
  mount: ConfigMount[];
  file?: never;
}

export interface ConfigServerRef {
  file: string;
  serverIndex?: number | undefined;
  serverPort?: number | undefined;
  includeMime: boolean;
  includeBackgroundTasks: boolean;
  mount?: never;
}

export interface ConfigBackgroundTask {
  command: string;
  arguments: string[];
  cwd: string;
  environment: Record<string, string>;
  options: {
    uid?: number | undefined;
    gid?: number | undefined;
    killSignal: NodeJS.Signals | number;
    displayStdout: boolean;
    displayStderr: boolean;
  };
}

export type ConfigMime = string | Record<string, string>;

export interface Config {
  servers: (ConfigServer | ConfigServerRef)[];
  backgroundTasks: ConfigBackgroundTask[];
  mime: ConfigMime | ConfigMime[];
  writeCompressed: boolean;
  minCompress: number;
  noServe: boolean;
  log: LogLevel;
}

export type ResolvedConfig = Omit<Config, 'servers'> & { servers: ConfigServer[] };
