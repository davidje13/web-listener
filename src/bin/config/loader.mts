import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config, type Config, type ConfigFileNegotiationOption } from './shape.mts';

const shorthands = new Map<string, string>([
  ['', 'dir'],
  ['-a', 'host'],
  ['-b', 'brotli'],
  ['-c', 'config-file'],
  ['-C', 'config-json'],
  ['-d', 'dir'],
  ['-g', 'gzip'],
  ['-h', 'help'],
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
  ['dir', { type: 'string' }],
  ['port', { type: 'number' }],
  ['host', { type: 'string' }],
  ['zstd', { type: 'boolean' }],
  ['brotli', { type: 'boolean' }],
  ['gzip', { type: 'boolean' }],
  ['deflate', { type: 'boolean' }],
  ['proxy', { type: 'string' }],
  ['mime', { type: 'string', multi: true }],
  ['mime-types', { type: 'string', multi: true }],
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
      throw new Error(`multiple values for: ${k}`);
    } else {
      lookup.set(key, value);
    }
  }
  return lookup;
}

export async function loadConfig(cwd: string, args: Map<string, unknown>): Promise<Config> {
  const stringListParam = (name: string) => (args.get(name) ?? []) as string[];
  const stringParam = (name: string) => args.get(name) as string | undefined;
  const fileParam = (name: string, fallback?: string) => {
    const v = stringParam(name) || fallback;
    if (v === undefined) {
      return undefined;
    }
    return resolve(cwd, v);
  };

  const file = fileParam('config-file');
  const json = stringParam('config-json');
  const dir = fileParam('dir', '.');
  const port = args.get('port') as number | undefined;
  const host = stringParam('host');
  const proxy = stringParam('proxy');
  const mime = stringListParam('mime');
  const mimeTypes = stringListParam('mime-types');

  if (Number(Boolean(file)) + Number(Boolean(json)) + Number(Boolean(proxy)) > 1) {
    throw new Error('multiple config files are not supported');
  }

  let c: unknown;
  if (file) {
    c = JSON.parse(await readFile(file, 'utf-8'));
  } else if (json) {
    c = JSON.parse(json);
  } else {
    const mount: unknown[] = [{ type: 'files', dir: dir }];
    c = { servers: [{ port: 8080, mount }] };
    if (proxy) {
      mount.push({ type: 'proxy', target: proxy });
    }
  }

  const sanitised = config(c);
  const singleServer = sanitised.servers.length === 1 ? sanitised.servers[0] : undefined;
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
    for (const server of sanitised.servers) {
      server.host = host;
    }
  }
  const addNegotiation = (
    type: 'mime' | 'language' | 'encoding',
    option: ConfigFileNegotiationOption,
  ) => {
    for (const server of sanitised.servers) {
      for (const mount of server.mount) {
        if (mount.type === 'files') {
          let enc = mount.options.negotiation.find((n) => n.type === type);
          if (!enc) {
            enc = { type, options: [] };
            mount.options.negotiation = [...mount.options.negotiation, enc];
          }
          if (!enc.options.find((o) => o.match === option.match)) {
            enc.options.push(option);
          }
        }
      }
    }
  };
  for (const enc of encodings) {
    if (args.get(enc.match)) {
      addNegotiation('encoding', enc);
    }
  }
  if (mime.length || mimeTypes.length) {
    if (!Array.isArray(sanitised.mime)) {
      if (sanitised.mime) {
        sanitised.mime = [sanitised.mime];
      } else {
        sanitised.mime = [];
      }
    }
    sanitised.mime.push(...mime);
    sanitised.mime.push(...mimeTypes.map((path) => `file://${path}`));
  }
  return sanitised;
}

const encodings = [
  { match: 'zstd', as: undefined, file: '{file}.zst' },
  { match: 'brotli', as: undefined, file: '{file}.br' },
  { match: 'gzip', as: undefined, file: '{file}.gz' },
  { match: 'deflate', as: undefined, file: '{file}.deflate' },
];
