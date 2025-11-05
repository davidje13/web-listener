#!/usr/bin/env -S node --disable-proto=delete --disallow-code-generation-from-strings --force-node-api-uncaught-exceptions-policy --no-addons
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { helpText } from './config/help.mts';
import { loadConfig, readArgs } from './config/loader.mts';
import type { Config } from './config/types.mts';
import { loadSchema, makeSchemaParser } from './config/schema.mts';
import { ServerManager } from './ServerManager.mts';
import { runCompression } from './compression.mts';
import { loadMime } from './mime.mts';

// https://nodejs.org/en/learn/getting-started/security-best-practices#dns-rebinding-cwe-346
process.on('SIGUSR1', () => {
  // ignore (disable default behaviour of opening inspector port)
});

function handleError(error: unknown) {
  process.stdin.destroy();
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
}

process.on('unhandledRejection', handleError);
process.on('uncaughtException', handleError);

const addColour =
  process.stderr.isTTY && !process.env['NO_COLOR']
    ? (id: string, message: string) => (id ? `\x1b[${id}m${message}\x1b[0m` : message)
    : (_: string, message: string) => message;

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

async function run() {
  const log = (message: string) => process.stderr.write(message + '\n');
  const manager = new ServerManager(log, addColour);
  process.on('unhandledRejection', () => manager.shutdown());
  process.on('uncaughtException', () => manager.shutdown());
  const parser = makeSchemaParser<Config>(await loadSchema());

  function stop() {
    process.stdin.destroy();
    manager.shutdown();
  }

  async function load() {
    const config = await loadConfig(parser, args);
    await loadMime(config.mime);
    if (config.writeCompressed) {
      await runCompression(config.servers, config.minCompress, log);
    }
    if (config.noServe) {
      stop();
    } else {
      manager.set(config.servers);
    }
  }

  function update() {
    process.stderr.write('refreshing config\n');
    return load();
  }

  load();
  process.on('SIGHUP', () => update());
  process.stdin.on('data', (data) => {
    if (data.includes('\n')) {
      update();
    }
  });
  process.on('SIGINT', () => {
    process.stderr.write('\n');
    stop();
  });
}

run();
