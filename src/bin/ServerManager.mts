import { spawn } from 'node:child_process';
import { createServer, type Server, type ServerOptions } from 'node:http';
import type { Readable, Writable } from 'node:stream';
import { findCause, HTTPError, WebListener, type ListenOptions } from '../index.mts';
import type { ConfigServer, ConfigServerOptions, ConfigBackgroundTask } from './config/types.mts';
import { buildRouter } from './buildRouter.mts';
import type { Logger, AddColour } from './log.mts';

export class ServerManager {
  declare private _started: boolean;
  declare private _building: boolean;
  declare private _stopping: boolean;
  declare private readonly _log: Logger;
  declare private readonly _colour: AddColour;
  declare private readonly _servers: Map<number, ServerState>;
  declare private _backgroundTasks: Set<BackgroundTaskState>;

  constructor(log: Logger, colour: AddColour) {
    this._started = false;
    this._building = false;
    this._stopping = false;
    this._log = log;
    this._colour = colour;
    this._servers = new Map();
    this._backgroundTasks = new Set();
  }

  async set(servers: ConfigServer[], backgroundTasks: ConfigBackgroundTask[]) {
    if (this._building || this._stopping) {
      return;
    }
    try {
      this._building = true;
      const preTasks: (() => Promise<void>)[] = [];
      const tasks: (() => Promise<void>)[] = [];

      const previousBackgroundTasks = this._backgroundTasks;
      this._backgroundTasks = new Set();
      tasksLoop: for (let i = 0; i < backgroundTasks.length; ++i) {
        const taskConfig = backgroundTasks[i]!;
        for (const taskState of previousBackgroundTasks) {
          if (backgroundTaskConfigEqual(taskState.config, taskConfig)) {
            this._backgroundTasks.add(taskState);
            previousBackgroundTasks.delete(taskState);
            continue tasksLoop;
          }
        }
        tasks.push(async () => {
          this._backgroundTasks.add(await this._startBackgroundTask(taskConfig));
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
          this._log(0, `servers[${i}] must have a specific port from 1 to 65535`);
          continue;
        }
        if (ports.has(port)) {
          this._log(0, `skipping servers[${i}] because port ${port} has already been defined`);
          continue;
        }
        ports.add(port);
        tasks.push(async () => {
          const state = await this._rerunServer(serverConfig, this._servers.get(port));
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

      const runTasks = async (tasks: (() => Promise<void>)[]) => {
        let failures: unknown[] = [];
        await Promise.all(
          tasks.map(async (task) => {
            try {
              await task();
            } catch (err) {
              failures.push(err);
            }
          }),
        );
        if (failures.length) {
          await this._shutdown();
          throw failures.length > 1 ? new AggregateError(failures) : failures[0]!;
        }
      };

      await runTasks(preTasks);
      await runTasks(tasks);

      if (this._stopping) {
        this._shutdown();
      } else if (this._servers.size) {
        this._log(1, 'all servers ready');
      } else {
        this._log(1, 'no servers configured');
      }
    } finally {
      this._building = false;
    }
  }

  private async _startBackgroundTask(config: ConfigBackgroundTask): Promise<BackgroundTaskState> {
    const name = this._colour('35', config.command);

    const ac = new AbortController();

    return new Promise((resolve, reject) => {
      this._log(2, `${name} ${this._colour('2', 'starting')}`);
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
        pipePrefixed(proc.stdout, `${name} ${this._colour('2', '[stdout]')} `, process.stderr);
      } else {
        proc.stdout.resume();
      }
      if (config.options.displayStderr) {
        pipePrefixed(proc.stderr, `${name} ${this._colour('2', '[stderr]')} `, process.stderr);
      } else {
        proc.stderr.resume();
      }
      proc.addListener('error', (err) => {
        this._log(0, `${name} startup failed: ${err.message}`);
        reject(err);
      });
      proc.addListener('exit', (code, signal) => {
        if (code !== null) {
          this._log(2, `${name} closed ${this._colour('2', `(exit code ${code})`)}`);
        } else {
          this._log(2, `${name} closed ${this._colour('2', `(exit signal ${signal})`)}`);
        }
      });
      proc.addListener('spawn', () =>
        resolve({
          config,
          close: () =>
            new Promise((closeResolve) => {
              if (proc.signalCode !== null || proc.exitCode !== null) {
                closeResolve();
              } else {
                this._log(
                  2,
                  `${name} ${this._colour('2', `closing (signal ${config.options.killSignal})`)}`,
                );
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
  ): Promise<ServerState | undefined> {
    const name = this._colour('34', `http://${host}:${port}`);
    const router = await buildRouter(
      mount,
      options.logRequests
        ? (info) => {
            const method = this._colour('1', info.method.replaceAll(/[^a-zA-Z0-9\-_]/g, '?'));
            const path = encodeURI(info.path);
            const status = this._colour(
              STATUS_COLOURS[(info.status / 100) | 0] ?? '',
              String(info.status),
            );
            const duration = this._colour('2', `(${info.duration}ms)`);
            this._log(0, `${name} ${method} ${path} ${status} ${duration}`);
          }
        : () => {},
    );
    const weblistener = new WebListener(router);
    weblistener.addEventListener('error', (evt) => {
      evt.preventDefault();
      const { error, context, request } = evt.detail;
      if ((findCause(error, HTTPError)?.statusCode ?? 500) >= 500) {
        this._log(0, `${name} ${this._colour('91', 'error')}: ${context} ${request?.url} ${error}`);
      }
    });

    let server: Server;
    let launch: Promise<void> | undefined;
    if (existing && host === existing.host && serverOptionsCompatible(options, existing.options)) {
      server = existing.server;
      this._log(2, `${name} updated`);
      existing.detach();
    } else {
      if (existing) {
        this._log(2, `${name} ${this._colour('2', 'restarting (step 1: shutdown)')}`);
        await existing.close();
        this._log(2, `${name} ${this._colour('2', 'restarting (step 2: start)')}`);
      } else {
        this._log(2, `${name} ${this._colour('2', 'starting')}`);
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
      this._log(2, `${name} ready`);
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
              this._log(2, `${name} closed`);
              resolve();
            });
            server.closeAllConnections();
          });
          const connections = listeners.countConnections();
          if (connections > 0) {
            this._log(
              2,
              `${name} ${this._colour('2', `closing (remaining connections: ${connections})`)}`,
            );
          }
        }),
    };
  }

  private async _shutdown() {
    if (this._servers.size) {
      this._log(2, this._colour('2', 'shutting down'));
      await Promise.all(
        [...this._servers.values(), ...this._backgroundTasks].map((state) => state.close()),
      );
    }
    if (this._started) {
      this._log(2, 'shutdown complete');
    }
  }

  shutdown() {
    if (this._stopping) {
      return;
    }
    this._stopping = true;
    if (!this._building) {
      this._shutdown();
    }
  }
}

const STATUS_COLOURS = ['', '37', '32', '36', '31', '41;97'];

function pipePrefixed(readable: Readable, prefix: string, target: Writable) {
  let line = '';
  const writeln = (ln: string) =>
    target.write(
      prefix +
        ln
          .replaceAll(/\x1b\[[\d;]*[A-K]/g, '')
          .replaceAll(
            /[\x00-\x1f]/g,
            (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`,
          ) +
        '\n',
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
  close: () => Promise<void>;
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
