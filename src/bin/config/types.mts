import type {
  ProxyOptions,
  FileServerOptions,
  CombinedServerOptions,
  FileNegotiation,
} from '../../index.mts';
import type { LogLevel } from '../log.mts';

interface ConfigMountFiles {
  type: 'files';
  path: string;
  dir: string;
  options: Omit<FileServerOptions, 'negotiator'> & { negotiation?: FileNegotiation[] };
}

interface ConfigMountProxy {
  type: 'proxy';
  path: string;
  target: string;
  options: ProxyOptions;
}

interface ConfigMountFixture {
  type: 'fixture';
  path: string;
  method: string;
  status: number;
  headers: Record<string, string | number | string[]>;
  body: string;
}

interface ConfigMountRedirect {
  type: 'redirect';
  path: string;
  status: number;
  target: string;
}

export type ConfigMount =
  | ConfigMountFiles
  | ConfigMountProxy
  | ConfigMountFixture
  | ConfigMountRedirect;

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
}

export type ConfigMime = string | Record<string, string>;

export interface Config {
  servers: ConfigServer[];
  mime: ConfigMime | ConfigMime[];
  writeCompressed: boolean;
  minCompress: number;
  noServe: boolean;
  log: LogLevel;
}
