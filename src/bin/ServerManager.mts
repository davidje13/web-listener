import { spawn } from 'node:child_process';
import { createServer, type Server, type ServerOptions } from 'node:http';
import type { Readable } from 'node:stream';
import { findCause, HTTPError, WebListener, type ListenOptions } from '../index.mts';
import type { ConfigServer, ConfigServerOptions, ConfigBackgroundTask } from './config/types.mts';
import { buildRouter } from './routes/buildRouter.mts';
import { markImportingDone } from './routes/custom/loadCustomHandler.mts';
import { clearZipCache } from './zipCache.mts';
import type { Logger } from './log.mts';
import { TransientError } from './TransientError.mts';

export class ServerManager {
  declare private _started: boolean;
  declare private _building: boolean;
  declare private _stopping: boolean;
  declare private readonly _servers: Map<number, ServerState>;
  declare private _backgroundTasks: Set<BackgroundTaskState>;
  declare private _autoRetry: NodeJS.Timeout | undefined;

  constructor() {
    this._started = false;
    this._building = false;
    this._stopping = false;
    this._servers = new Map();
    this._backgroundTasks = new Set();
  }

  async set(
    servers: ConfigServer[],
    backgroundTasks: ConfigBackgroundTask[],
    log: Logger,
    errorHandler: (error: unknown) => void,
  ) {
    if (this._building || this._stopping) {
      return;
    }
    clearTimeout(this._autoRetry);
    this._autoRetry = undefined;
    try {
      this._building = true;
      const preTasks: (() => Promise<void>)[] = [];
      const tasks: (() => Promise<void>)[] = [];

      let canRetry = false;
      const previousBackgroundTasks = this._backgroundTasks;
      this._backgroundTasks = new Set();
      tasksLoop: for (let i = 0; i < backgroundTasks.length; ++i) {
        const taskConfig = backgroundTasks[i]!;
        for (const taskState of previousBackgroundTasks) {
          if (backgroundTaskConfigEqual(taskState.config, taskConfig)) {
            canRetry ||= taskState.isRunning();
            this._backgroundTasks.add(taskState);
            previousBackgroundTasks.delete(taskState);
            continue tasksLoop;
          }
        }
        canRetry = true;
        tasks.push(async () => {
          this._backgroundTasks.add(await this._startBackgroundTask(taskConfig, log));
        });
      }
      for (const taskState of previousBackgroundTasks) {
        preTasks.push(taskState.close);
      }

      const ports = new Set<number>();
      for (let i = 0; i < servers.length; ++i) {
        const serverConfig = servers[i]!;
        const port = serverConfig.port;
        if (port <= 0 || port > 65535) {
          log(0, {
            type: 'warn',
            message: `servers[${i}] must have a specific port from 1 to 65535`,
          });
          continue;
        }
        if (ports.has(port)) {
          log(0, {
            type: 'warn',
            message: `skipping servers[${i}] because port ${port} has already been defined`,
          });
          continue;
        }
        ports.add(port);
        tasks.push(async () => {
          const state = await this._rerunServer(serverConfig, this._servers.get(port), log);
          if (state) {
            this._servers.set(port, state);
          } else {
            this._servers.delete(port);
          }
        });
      }
      this._started ||= tasks.length > 0;
      for (const [port, state] of this._servers) {
        if (!ports.has(port)) {
          tasks.push(state.close);
          this._servers.delete(port);
        }
      }

      let doRetry = false;
      const runTasks = async (tasks: (() => Promise<void>)[]) => {
        let failures: unknown[] = [];
        await Promise.all(
          tasks.map(async (task) => {
            try {
              await task();
            } catch (error: unknown) {
              if (canRetry && !this._stopping && error instanceof TransientError) {
                log(1, { type: 'warn', message: `${error.message} (retrying)` });
                doRetry = true;
              } else {
                failures.push(error);
              }
            }
          }),
        );
        if (failures.length) {
          await this._shutdown(log);
          throw failures.length > 1 ? new AggregateError(failures) : failures[0]!;
        }
      };

      await runTasks(preTasks);
      await runTasks(tasks);
      markImportingDone();

      if (this._stopping) {
        this._shutdown(log);
      } else if (doRetry) {
        this._autoRetry = setTimeout(() => {
          clearZipCache();
          this.set(servers, backgroundTasks, log, errorHandler);
        }, 1000);
      } else if (this._servers.size) {
        log(1, { message: 'all servers ready' });
      } else {
        log(1, { message: 'no servers configured' });
      }
    } catch (error: unknown) {
      errorHandler(error);
    } finally {
      this._building = false;
    }
  }

  private async _startBackgroundTask(
    config: ConfigBackgroundTask,
    log: Logger,
  ): Promise<BackgroundTaskState> {
    const logBase = { service: config.command, serviceCol: '35' };

    const ac = new AbortController();

    return new Promise((resolve, reject) => {
      log(2, { ...logBase, type: 'detail', message: 'starting' });
      let running = true;
      const proc = spawn(config.command, config.arguments, {
        cwd: config.cwd,
        env: { ...process.env, TERM: '', COLORTERM: '', NO_COLOR: '1', ...config.environment },
        killSignal: config.options.killSignal,
        uid: config.options.uid,
        gid: config.options.gid,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: ac.signal,
      });
      if (config.options.displayStdout) {
        watchOutput(proc.stdout, (ln) => log(0, { ...logBase, thread: 'stdout', message: ln }));
      } else {
        proc.stdout.resume();
      }
      if (config.options.displayStderr) {
        watchOutput(proc.stderr, (ln) => log(0, { ...logBase, thread: 'stderr', message: ln }));
      } else {
        proc.stderr.resume();
      }
      proc.addListener('error', (err) => {
        log(0, { ...logBase, type: 'error', message: `startup failed: ${err.message}` });
        running = false;
        reject(err);
      });
      proc.addListener('exit', (code, signal) => {
        log(2, {
          ...logBase,
          message: 'closed',
          stats: code !== null ? { code } : { signal },
        });
        running = false;
      });
      proc.addListener('spawn', () =>
        resolve({
          config,
          isRunning: () => running,
          close: () =>
            new Promise((closeResolve) => {
              if (proc.signalCode !== null || proc.exitCode !== null) {
                closeResolve();
              } else {
                log(2, {
                  ...logBase,
                  type: 'detail',
                  message: 'closing',
                  stats: { signal: config.options.killSignal },
                });
                proc.addListener('exit', closeResolve);
                proc.kill(config.options.killSignal);
              }
            }),
        }),
      );
    });
  }

  private async _rerunServer(
    { port, host, options, mount }: ConfigServer,
    existing: ServerState | undefined,
    log: Logger,
  ): Promise<ServerState | undefined> {
    const logBase = { service: `http://${host}:${port}`, serviceCol: '34' };
    const router = await buildRouter(
      mount,
      (warning) => log(1, { ...logBase, type: 'warn', message: warning }),
      options.logRequests
        ? (info) =>
            log(0, {
              ...logBase,
              method: info.method,
              path: info.path,
              status: info.status,
              stats: { duration: info.duration },
            })
        : undefined,
    );
    const weblistener = new WebListener(router);
    weblistener.addEventListener('error', (evt) => {
      evt.preventDefault();
      const { error, context, request } = evt.detail;
      if ((findCause(error, HTTPError)?.statusCode ?? 500) >= 500) {
        log(0, {
          ...logBase,
          thread: context,
          type: 'error',
          path: request?.url,
          message: String(error),
        });
      }
    });

    let server: Server;
    let launch: Promise<void> | undefined;
    if (existing && host === existing.host && serverOptionsCompatible(options, existing.options)) {
      server = existing.server;
      log(2, { ...logBase, message: 'updated' });
      existing.detach();
    } else {
      if (existing) {
        log(2, { ...logBase, type: 'detail', message: 'restarting (step 1: shutdown)' });
        await existing.close();
        log(2, { ...logBase, type: 'detail', message: 'restarting (step 2: start)' });
      } else {
        log(2, { ...logBase, type: 'detail', message: 'starting' });
      }
      if (this._stopping) {
        return undefined;
      }
      server = createServer(options);
      server.setTimeout(options.socketTimeout);
      launch = listen(server, port, host, options.backlog);
    }

    const detach = weblistener.attach(server, options);
    if (launch) {
      await launch;
      // wait an extra tick before confirming we are ready (required on Linux)
      await new Promise((resolve) => setTimeout(resolve, 1));
      log(2, { ...logBase, message: 'ready' });
    }
    return {
      host,
      options,
      server,
      detach: () => detach('restart', options.restartTimeout),
      close: () =>
        new Promise<void>((resolve) => {
          const listeners = detach('shutdown', options.shutdownTimeout, true, () => {
            server.close(() => {
              // ignore any error (happens if server is already closed)
              log(2, { ...logBase, message: 'closed' });
              resolve();
            });
            server.closeAllConnections();
          });
          const connections = listeners.countConnections();
          if (connections > 0) {
            log(2, {
              ...logBase,
              type: 'detail',
              message: 'closing',
              stats: { connections },
            });
          }
        }),
    };
  }

  private async _shutdown(log: Logger) {
    if (this._servers.size) {
      log(2, { type: 'detail', message: 'shutting down' });
      await Promise.all(
        [...this._servers.values(), ...this._backgroundTasks].map((state) => state.close()),
      );
    }
    if (this._started) {
      log(2, { message: 'shutdown complete' });
    }
  }

  shutdown(log: Logger) {
    if (this._stopping) {
      return;
    }
    clearTimeout(this._autoRetry);
    this._autoRetry = undefined;
    this._stopping = true;
    if (!this._building) {
      this._shutdown(log);
    }
  }
}

function watchOutput(readable: Readable, lineHandler: (ln: string) => void) {
  let line = '';
  const writeln = (ln: string) =>
    lineHandler(
      ln
        .replaceAll(/\x1b\[[\d;]*[A-K]/g, '')
        .replaceAll(/[\x00-\x1f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`),
    );
  readable.addListener('data', (chunk) => {
    line += chunk;
    const parts = line.split('\n');
    line = parts.pop()!;
    for (const ln of parts) {
      writeln(ln);
    }
  });
  readable.addListener('end', () => {
    if (line) {
      writeln(line);
    }
  });
}

const listen = async (server: Server, port: number, host: string, backlog: number = 511) =>
  new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, backlog, () => {
      server.off('error', reject);
      resolve();
    });
  });

interface ServerState {
  host: string;
  options: ConfigServerOptions;
  server: Server;
  detach: () => void;
  close: () => Promise<void>;
}

interface BackgroundTaskState {
  config: ConfigBackgroundTask;
  close(): Promise<void>;
  isRunning(): boolean;
}

function backgroundTaskConfigEqual(a: ConfigBackgroundTask, b: ConfigBackgroundTask) {
  return (
    a.command === b.command &&
    a.arguments.length === b.arguments.length &&
    a.arguments.every((arg, i) => arg === b.arguments[i]) &&
    a.cwd === b.cwd &&
    JSON.stringify(a.environment) === JSON.stringify(b.environment) &&
    a.options.uid === b.options.uid &&
    a.options.gid === b.options.gid &&
    a.options.killSignal === b.options.killSignal &&
    a.options.displayStdout === b.options.displayStdout &&
    a.options.displayStderr === b.options.displayStderr
  );
}

function serverOptionsCompatible(a: ConfigServerOptions, b: ConfigServerOptions) {
  // returns false if the options have changed in a way that requires closing the current server and opening a new one.
  for (const value of SERVER_OPTIONS) {
    if (a[value] !== b[value]) {
      return false;
    }
  }
  return true;
}

const SERVER_OPTIONS: (keyof ConfigServerOptions & keyof (ServerOptions & ListenOptions))[] = [
  'requestTimeout',
  'keepAliveTimeout',
  'keepAliveTimeoutBuffer',
  'connectionsCheckingInterval',
  'headersTimeout',
  'highWaterMark',
  'maxHeaderSize',
  'noDelay',
  'requireHostHeader',
  'keepAlive',
  'keepAliveInitialDelay',
  'uniqueHeaders',
  'backlog',
  'socketTimeout',
];
