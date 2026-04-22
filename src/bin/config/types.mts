import type {
  ProxyOptions,
  FileServerOptions,
  CombinedServerOptions,
  FileNegotiation,
} from '../../index.mts';
import type { DependencyHandlerOptions } from '../modules/dependencies.mts';
import type { LogLevel } from '../log.mts';

export type ConfigHeaders = Record<string, string | string[]>;

export type ConfigMountFilesOptions = Omit<FileServerOptions, 'negotiator'> & {
  negotiation?: FileNegotiation[];
  headers?: ConfigHeaders;
};

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
    headers?: ConfigHeaders;
  };
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

interface ConfigMountDependencies {
  type: 'dependencies';
  path: string;
  package: string;
  options: Omit<DependencyHandlerOptions, 'negotiator' | 'fallback'> & {
    headers?: ConfigHeaders;
  };
}

export type ConfigMount =
  | ConfigMountFiles
  | ConfigMountProxy
  | ConfigMountFixture
  | ConfigMountRedirect
  | ConfigMountDependencies;

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
  servers: ConfigServer[];
  backgroundTasks: ConfigBackgroundTask[];
  mime: ConfigMime | ConfigMime[];
  writeCompressed: boolean;
  minCompress: number;
  noServe: boolean;
  log: LogLevel;
}
