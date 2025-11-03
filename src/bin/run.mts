#!/usr/bin/env -S node --disable-proto=delete --disallow-code-generation-from-strings --force-node-api-uncaught-exceptions-policy --no-addons
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { decompressMime, readMimeTypes, registerMime, resetMime } from '../index.mts';
import { loadConfig, readArgs } from './config/loader.mts';
import { ServerManager } from './ServerManager.mts';
import { helpText } from './config/help.mts';

// https://nodejs.org/en/learn/getting-started/security-best-practices#dns-rebinding-cwe-346
process.on('SIGUSR1', () => {
  // ignore (disable default behaviour of opening inspector port)
});

const manager = new ServerManager(
  (message) => process.stderr.write(message + '\n'),
  (id, message) => {
    if (!id || !process.stderr.isTTY || process.env['NO_COLOR']) {
      return message;
    }
    return `\x1b[${id}m${message}\x1b[0m`;
  },
);

function handleError(error: unknown) {
  process.stdin.destroy();
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  manager.shutdown();
}

process.on('unhandledRejection', handleError);
process.on('uncaughtException', handleError);

const cwd = process.cwd();
const args = readArgs(process.argv.slice(2));

if (args.get('version') || args.get('help')) {
  const pkg = JSON.parse(
    await readFile(join(dirname(new URL(import.meta.url).pathname), 'package.json'), 'utf-8'),
  );
  process.stdout.write(`${pkg.name} ${pkg.version}\n`);
  if (args.get('help')) {
    process.stdout.write(helpText(pkg.name).join('\n') + '\n');
  }
  process.exit(0);
}

async function reload() {
  const { servers, mime } = await loadConfig(cwd, args);
  manager.set(servers);
  const newMimes: Map<string, string>[] = [];
  for (const item of mime) {
    if (typeof item !== 'string') {
      newMimes.push(new Map(Object.entries(item)));
    } else if (item.startsWith('file://')) {
      newMimes.push(readMimeTypes(await readFile(item.substring(7), 'utf-8')));
    } else {
      newMimes.push(decompressMime(item));
    }
  }
  resetMime();
  for (const item of newMimes) {
    registerMime(item);
  }
}

function update() {
  process.stderr.write('refreshing config\n');
  return reload();
}

reload();
process.on('SIGHUP', () => update());
process.stdin.on('data', (data) => {
  if (data.includes('\n')) {
    update();
  }
});
process.on('SIGINT', () => {
  process.stdin.destroy();
  process.stderr.write('\n');
  manager.shutdown();
});
