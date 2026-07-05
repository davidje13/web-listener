import { resolve } from 'node:path';
import type { FallbackOptions, FileNegotiation, FileNegotiationOption } from '../../index.mts';
import { readAnyFile } from '../zipCache.mts';
import type { Mapper } from './schema.mts';
import type {
  Config,
  ConfigHeaders,
  ConfigMount,
  ConfigServerRef,
  ResolvedConfig,
} from './types.mts';

const shorthands = new Map<string, string>([
  ['', 'dir'],
  ['-a', 'host'],
  ['-b', 'brotli'],
  ['-c', 'config-file'],
  ['-C', 'config-json'],
  ['-d', 'dir'],
  ['-e', 'ext'],
  ['-g', 'gzip'],
  ['-h', 'help'],
  ['-H', 'header'],
  ['-p', 'port'],
  ['-P', 'proxy'],
  ['-v', 'version'],
  ['br', 'brotli'],
  ['gz', 'gzip'],
  ['zst', 'zstd'],
]);
const params = new Map<string, { type: 'string' | 'number' | 'boolean'; multi?: boolean }>([
  ['config-file', { type: 'string' }],
  ['config-json', { type: 'string' }],
  ['dir', { type: 'string', multi: true }],
  ['exec', { type: 'string', multi: true }],
  ['ext', { type: 'string', multi: true }],
  ['port', { type: 'number' }],
  ['host', { type: 'string' }],
  ['zstd', { type: 'boolean' }],
  ['brotli', { type: 'boolean' }],
  ['gzip', { type: 'boolean' }],
  ['deflate', { type: 'boolean' }],
  ['proxy', { type: 'string' }],
  ['404', { type: 'string' }],
  ['spa', { type: 'string' }],
  ['header', { type: 'string', multi: true }],
  ['dependencies', { type: 'string' }],
  ['mime', { type: 'string', multi: true }],
  ['mime-types', { type: 'string', multi: true }],
  ['redirect-map', { type: 'string', multi: true }],
  ['write-compressed', { type: 'boolean' }],
  ['min-compress', { type: 'number' }],
  ['no-serve', { type: 'boolean' }],
  ['log', { type: 'string' }],
  ['help', { type: 'boolean' }],
  ['version', { type: 'boolean' }],
]);

export function readArgs(argv: string[]) {
  const config: [string, string][] = [];
  for (let i = 0; i < argv.length; ++i) {
    const arg = argv[i]!;
    if (arg === '--') {
      continue;
    }
    const longParts = /^--([^ =\-][^ =]*)=(.*)$/.exec(arg);
    if (longParts) {
      config.push([longParts[1]!, longParts[2]!]);
      continue;
    }
    const shortParts = /^-([^ =]*)([^ =])=(.*)$/.exec(arg);
    if (shortParts && arg[1] !== '-') {
      for (const c of shortParts[1]!) {
        config.push(['-' + c, '']);
      }
      config.push(['-' + shortParts[2]!, shortParts[3]!]);
      continue;
    }
    if (arg[0] !== '-' || arg === '-') {
      if (i === 0) {
        config.push(['', arg]);
      } else {
        throw new Error(`value without key: ${arg}`);
      }
      continue;
    }
    let next = argv[i + 1];
    if (next && next[0] === '-' && next.length > 1) {
      next = undefined;
    }
    if (next !== undefined) {
      ++i;
    }
    if (arg[1] === '-') {
      config.push([arg.slice(2), next ?? '']);
    } else {
      for (const c of arg.slice(1, arg.length - 1)) {
        config.push(['-' + c, '']);
      }
      config.push(['-' + arg[arg.length - 1]!, next ?? '']);
    }
  }
  const lookup = new Map<string, unknown>();
  for (const [k, v] of config) {
    const key = (shorthands.get(k) ?? k).toLowerCase();
    const type = params.get(key);
    if (!type) {
      throw new Error(`unknown flag: ${k}`);
    }
    let value: unknown;
    switch (type.type) {
      case 'string':
        value = v;
        break;
      case 'number':
        value = Number.parseFloat(v);
        break;
      case 'boolean':
        value = ['', 'on', 'true', 'yes', 'y', '1'].includes(v.toLowerCase());
        break;
    }
    if (type.multi) {
      let list = lookup.get(key);
      if (!list) {
        list = [];
        lookup.set(key, list);
      }
      (list as unknown[]).push(value);
    } else if (lookup.has(key)) {
      throw new Error(`multiple values for ${key}`);
    } else {
      lookup.set(key, value);
    }
  }
  return lookup;
}

export async function loadConfig(
  parser: Mapper<Config>,
  args: Map<string, unknown>,
): Promise<ResolvedConfig> {
  const stringListParam = (name: string, fallback: string[] = []) =>
    (args.get(name) ?? fallback) as string[];
  const stringParam = (name: string) => args.get(name) as string | undefined;
  const numberParam = (name: string) => args.get(name) as number | undefined;

  const file = stringParam('config-file');
  const json = stringParam('config-json');
  const port = numberParam('port');
  const host = stringParam('host');
  const dirs = stringListParam('dir');
  const exec = stringListParam('exec').map((v) => v.split(' '));
  const ext = stringListParam('ext').map((v) => (v.startsWith('.') ? v : `.${v}`));
  const headers = stringListParam('header').map((v) => splitFirst(v, /: ?/));
  const err404 = stringParam('404');
  const spa = stringParam('spa');
  const proxy = stringParam('proxy');
  const dependencies = stringParam('dependencies');
  const minCompress = numberParam('min-compress');
  const mime = stringListParam('mime');
  const mimeTypes = stringListParam('mime-types');
  const redirectMap = stringListParam('redirect-map');
  const log = stringParam('log');

  if (Number(Boolean(file)) + Number(Boolean(json)) + Number(Boolean(proxy)) > 1) {
    throw new Error('multiple config files are not supported');
  }

  let config: ResolvedConfig;
  if (file) {
    config = await loadConfigFileNetwork(null, file, parser);
  } else if (json) {
    config = await loadConfigFileNetwork(json, '', parser);
  } else {
    if (!dirs.length) {
      dirs.push('.');
    }
    config = parser(
      { servers: [{ port: 8080, mount: [] }] },
      { file: '', path: '' },
    ) as ResolvedConfig;
  }

  for (const task of exec) {
    config.backgroundTasks.push({
      command: task[0]!,
      arguments: task.slice(1),
      cwd: process.cwd(),
      environment: {},
      options: { killSignal: 'SIGTERM', displayStdout: true, displayStderr: true },
    });
  }

  const singleServer = config.servers.length === 1 ? config.servers[0] : undefined;
  if (port !== undefined) {
    if ((port | 0) !== port) {
      throw new Error('port must be an integer');
    }
    if (singleServer) {
      singleServer.port = port;
    } else {
      throw new Error('cannot specify port on commandline when defining multiple servers');
    }
  }
  if (host !== undefined) {
    for (const server of config.servers) {
      server.host = host;
    }
  }
  if (dirs.length || spa || err404) {
    if (!singleServer) {
      throw new Error(
        'cannot specify dir, spa, or 404 on commandline when defining multiple servers',
      );
    }
    let fallback: FallbackOptions | undefined;
    if (spa) {
      fallback = { statusCode: 200, filePath: spa };
    } else if (err404) {
      fallback = { statusCode: 404, filePath: err404 };
    }
    for (let i = 0; i < dirs.length; ++i) {
      const dir = dirs[i]!;
      const isLast = i === dirs.length - 1;
      singleServer.mount.push({
        type: 'files',
        path: '/',
        dir,
        options: { fallback: isLast ? fallback : undefined },
      });
    }
  }
  if (proxy) {
    if (!singleServer) {
      throw new Error('cannot specify proxy on commandline when defining multiple servers');
    }
    singleServer.mount.push({ type: 'proxy', path: '/', target: proxy, options: {} });
  }

  if (redirectMap.length > 0) {
    for (const server of config.servers) {
      for (const filePath of redirectMap) {
        server.mount.unshift({
          type: 'redirect-map',
          mapping: filePath,
          status: 307,
          options: { caseSensitive: false },
        });
      }
    }
  }
  if (dependencies !== undefined) {
    for (const server of config.servers) {
      server.mount.push({
        type: 'dependencies',
        path: '/node_modules',
        package: dependencies,
        options: {},
      });
    }
  }
  const addNegotiation = (feature: FileNegotiation['feature'], encoding: FileNegotiationOption) => {
    for (const server of config.servers) {
      for (const mount of server.mount) {
        if (mount.type === 'files') {
          mount.options.negotiation ??= [];
          let enc = mount.options.negotiation.find((n) => n.feature === feature);
          if (!enc) {
            enc = { feature, options: [] };
            mount.options.negotiation = [...mount.options.negotiation, enc];
          }
          if (!enc.options.find((o) => o.value === encoding.value)) {
            enc.options.push(encoding);
          }
        }
      }
    }
  };
  for (const [flag, enc] of ENCODINGS) {
    if (args.get(flag)) {
      addNegotiation('encoding', enc);
    }
  }
  if (ext.length) {
    for (const server of config.servers) {
      for (const mount of server.mount) {
        if (mount.type === 'files') {
          mount.options.implicitSuffixes = ext;
        }
      }
    }
  }
  if (headers.length) {
    const headerMount: ConfigMount = { type: 'headers', path: '/', headers: toHeaders(headers) };
    for (const server of config.servers) {
      server.mount.unshift(headerMount);
    }
  }
  if (mime.length || mimeTypes.length) {
    config.mime = [...asArray(config.mime), ...mime, ...mimeTypes.map((path) => `file://${path}`)];
  }
  if (args.get('write-compressed')) {
    config.writeCompressed = true;
  }
  if (minCompress !== undefined) {
    config.minCompress = minCompress;
  }
  if (args.get('no-serve')) {
    config.noServe = true;
  }
  switch (log) {
    case 'none':
    case 'ready':
    case 'progress':
      config.log = log;
      for (const server of config.servers) {
        server.options.logRequests = false;
      }
      for (const task of config.backgroundTasks) {
        task.options.displayStderr = false;
        task.options.displayStdout = false;
      }
      break;
    case 'full':
      config.log = 'progress';
      break;
  }
  return config;
}

async function loadConfigFileNetwork(
  content: string | null,
  file: string,
  parser: Mapper<Config>,
): Promise<ResolvedConfig> {
  const seen = new Map<string, ResolvedConfig | true>();

  const followLink = async (target: Config, options: ConfigServerRef) => {
    const sub = await loadRecur(options.file, null);
    if (options.includeMime) {
      target.mime = [...asArray(target.mime), ...asArray(sub.mime)];
      sub.mime = [];
    }
    if (options.includeBackgroundTasks) {
      target.backgroundTasks.push(...sub.backgroundTasks);
      sub.backgroundTasks = [];
    }
    if (options.serverPort !== undefined) {
      return sub.servers.filter((o) => o.port === options.serverPort);
    } else if (options.serverIndex !== undefined) {
      if (options.serverIndex < 0 || options.serverIndex >= sub.servers.length) {
        return [];
      }
      return [sub.servers[options.serverIndex]!];
    } else {
      return sub.servers;
    }
  };

  async function loadRecur(absFile: string, content: string | null) {
    const existing = seen.get(absFile);
    if (existing) {
      if (existing === true) {
        throw new Error(`circular reference to ${absFile}`);
      }
      return existing;
    }
    seen.set(absFile, true);
    if (content === null) {
      content = await readAnyFile(absFile);
    }
    const config = parser(JSON.parse(content), { file: absFile, path: '' });
    for (let i = 0; i < config.servers.length; ) {
      const server = config.servers[i]!;
      if (server.mount) {
        for (let j = 0; j < server.mount.length; ++j) {
          const mount = server.mount[j]!;
          if (mount.type === 'delegate') {
            const servers = await followLink(config, mount.config);
            if (servers.length !== 1) {
              throw new Error(
                `${servers.length > 1 ? 'multiple' : 'no'} servers found in ${mount.config.file} matching requirements`,
              );
            }
            server.mount[j] = { type: 'nested', path: mount.path, mount: servers[0]!.mount };
          }
        }
        ++i;
      } else {
        const servers = await followLink(config, server);
        if (!servers) {
          throw new Error(`no servers found in ${server.file} matching requirements`);
        }
        config.servers.splice(i, 1, ...servers);
        i += servers.length;
      }
    }
    const resolvedConfig = config as ResolvedConfig;
    seen.set(absFile, resolvedConfig);
    return resolvedConfig;
  }

  return loadRecur(resolve(file || '.'), content);
}

function splitFirst(v: string, sep: RegExp): [string, string?] {
  const m = v.match(sep);
  return m ? [v.substring(0, m.index!), v.substring(m.index! + m[0].length)] : [v];
}

function toHeaders(headers: [string, string?][]): ConfigHeaders {
  const lookup = new Map<string, string[]>();
  for (const [header, value = ''] of headers) {
    const existing = lookup.get(header);
    if (existing) {
      existing.push(value);
    } else {
      lookup.set(header, [value]);
    }
  }
  return Object.fromEntries(lookup.entries());
}

const ENCODINGS = new Map<string, FileNegotiationOption>([
  ['zstd', { value: 'zstd', file: '{file}.zst' }],
  ['brotli', { value: 'br', file: '{file}.br' }],
  ['gzip', { value: 'gzip', file: '{file}.gz' }],
  ['deflate', { value: 'deflate', file: '{file}.deflate' }],
]);

const asArray = <T,>(v: T | T[]) => (Array.isArray(v) ? v : v ? [v] : []);
