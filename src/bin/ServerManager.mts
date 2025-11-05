import { createServer, type Server, type ServerOptions } from 'node:http';
import { WebListener, type ListenOptions } from '../index.mts';
import type { ConfigServer, ConfigServerOptions } from './config/types.mts';
import { buildRouter } from './buildRouter.mts';

export class ServerManager {
  private _started: boolean;
  private _building: boolean;
  private _stopping: boolean;
  private readonly _log: (message: string) => void;
  private readonly _colour: (id: string, message: string) => string;
  private readonly _servers: Map<number, ServerState>;

  constructor(log: (message: string) => void, colour: (id: string, message: string) => string) {
    this._started = false;
    this._building = false;
    this._stopping = false;
    this._log = log;
    this._colour = colour;
    this._servers = new Map();
  }

  async set(servers: ConfigServer[]) {
    if (this._building || this._stopping) {
      return;
    }
    try {
      this._building = true;
      const ports = new Set<number>();
      const tasks: (() => Promise<void>)[] = [];
      for (let i = 0; i < servers.length; ++i) {
        const serverConfig = servers[i]!;
        const port = serverConfig.port;
        if (port <= 0 || port > 65535) {
          this._log(`servers[${i}] must have a specific port from 1 to 65535`);
          continue;
        }
        if (ports.has(port)) {
          this._log(`skipping servers[${i}] because port ${port} has already been defined`);
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
      await Promise.all(tasks.map((task) => task()));
      if (this._stopping) {
        this._shutdown();
      } else if (this._servers.size) {
        this._log('all servers ready');
      } else {
        this._log('no servers configured');
      }
    } finally {
      this._building = false;
    }
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
            this._log(`${name} ${method} ${path} ${status} ${duration}`);
          }
        : () => {},
    );
    const weblistener = new WebListener(router);
    weblistener.addEventListener('error', ({ detail: { action, error, request } }) => {
      this._log(`${name} ${this._colour('91', 'error')}: ${action} ${request?.url} ${error}`);
    });

    let server: Server;
    let launch: Promise<void> | undefined;
    if (existing && host === existing.host && serverOptionsCompatible(options, existing.options)) {
      server = existing.server;
      this._log(`${name} updated`);
      existing.detach();
    } else {
      if (existing) {
        this._log(`${name} ${this._colour('2', 'restarting (step 1: shutdown)')}`);
        await existing.close();
        this._log(`${name} ${this._colour('2', 'restarting (step 2: start)')}`);
      } else {
        this._log(`${name} ${this._colour('2', 'starting')}`);
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
      this._log(`${name} ready`);
    }
    return {
      host,
      options,
      server,
      detach: () => detach('restart', options.restartTimeout),
      close: () =>
        new Promise<void>((resolve) => {
          server.close(() => {
            // ignore any error (happens if server is already closed)
            this._log(`${name} closed`);
            resolve();
          });
          const listeners = detach('shutdown', options.shutdownTimeout, true);
          const connections = listeners.countConnections();
          if (connections > 0) {
            this._log(
              `${name} ${this._colour('2', `closing (remaining connections: ${connections})`)}`,
            );
          }
        }),
    };
  }

  private async _shutdown() {
    if (this._servers.size) {
      this._log(this._colour('2', 'shutting down'));
      await Promise.all([...this._servers.values()].map((state) => state.close()));
    }
    if (this._started) {
      this._log('shutdown complete');
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
