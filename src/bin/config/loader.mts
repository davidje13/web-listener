import { readFile } from 'node:fs/promises';
import type { FileNegotiation, FileNegotiationOption } from '../../index.mts';
import type { Mapper } from './schema.mts';
import type { Config } from './types.mts';

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
  ['mime', { type: 'string', multi: true }],
  ['mime-types', { type: 'string', multi: true }],
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
): Promise<Config> {
  const stringListParam = (name: string) => (args.get(name) ?? []) as string[];
  const stringParam = (name: string) => args.get(name) as string | undefined;
  const numberParam = (name: string) => args.get(name) as number | undefined;

  const file = stringParam('config-file');
  const json = stringParam('config-json');
  const port = numberParam('port');
  const host = stringParam('host');
  const dir = stringParam('dir') || '.';
  const ext = stringListParam('ext').map((v) => (v.startsWith('.') ? v : `.${v}`));
  const err404 = stringParam('404');
  const spa = stringParam('spa');
  const proxy = stringParam('proxy');
  const minCompress = numberParam('min-compress');
  const mime = stringListParam('mime');
  const mimeTypes = stringListParam('mime-types');
  const log = stringParam('log');

  if (Number(Boolean(file)) + Number(Boolean(json)) + Number(Boolean(proxy)) > 1) {
    throw new Error('multiple config files are not supported');
  }

  let config: Config;
  if (file) {
    config = parser(JSON.parse(await readFile(file, 'utf-8')), { file, path: '' });
  } else if (json) {
    config = parser(JSON.parse(json), { file: '', path: '' });
  } else {
    let fallback: unknown;
    if (spa) {
      fallback = { statusCode: 200, filePath: spa };
    } else if (err404) {
      fallback = { statusCode: 404, filePath: err404 };
    }
    const mount: unknown[] = [{ type: 'files', dir: dir, options: { fallback } }];
    if (proxy) {
      mount.push({ type: 'proxy', target: proxy });
    }
    config = parser({ servers: [{ port: 8080, mount }] }, { file: '', path: '' });
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
  if (mime.length || mimeTypes.length) {
    if (!Array.isArray(config.mime)) {
      if (config.mime) {
        config.mime = [config.mime];
      } else {
        config.mime = [];
      }
    }
    config.mime.push(...mime);
    config.mime.push(...mimeTypes.map((path) => `file://${path}`));
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
      break;
    case 'full':
      config.log = 'progress';
      break;
  }
  return config;
}

const ENCODINGS = new Map<string, FileNegotiationOption>([
  ['zstd', { value: 'zstd', file: '{file}.zst' }],
  ['brotli', { value: 'br', file: '{file}.br' }],
  ['gzip', { value: 'gzip', file: '{file}.gz' }],
  ['deflate', { value: 'deflate', file: '{file}.deflate' }],
]);
