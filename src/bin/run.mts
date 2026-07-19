#!/usr/bin/env -S node --disable-proto=delete --disallow-code-generation-from-strings --force-node-api-uncaught-exceptions-policy --no-addons --experimental-import-meta-resolve
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, readArgs } from './config/loader.mts';
import type { Config } from './config/types.mts';
import { loadSchema, makeSchemaParser } from './config/schema.mts';
import { clearZipCache } from './zipCache.mts';
import { ServerManager } from './ServerManager.mts';
import { runCompression } from './compression.mts';
import { loadMime } from './mime.mts';
import { jsonLogger, textLogger } from './log.mts';

// https://nodejs.org/en/learn/getting-started/security-best-practices#dns-rebinding-cwe-346
process.on('SIGUSR1', () => {
  // ignore (disable default behaviour of opening inspector port)
});

const logTarget = process.stderr;
let log = textLogger(logTarget, 'progress', true);

function handleError(error: unknown) {
  process.stdin.destroy();
  log(0, { type: 'error', message: error });
}

process.on('unhandledRejection', handleError);
process.on('uncaughtException', handleError);

const args = readArgs(process.argv.slice(2));
const selfDir = dirname(fileURLToPath(import.meta.url));

if (args.get('version') || args.get('help')) {
  let pkg = { name: 'web-listener', version: 'unknown' };
  try {
    pkg = JSON.parse(await readFile(join(selfDir, 'package.json'), 'utf-8'));
  } catch {}

  if (args.get('help')) {
    spawnSync('man', ['-M', selfDir, pkg.name], {
      stdio: ['inherit', 'inherit', 'inherit'],
    });
  } else {
    process.stdout.write(`${pkg.name} ${pkg.version}\n`);
  }
  process.exit(0);
}

async function run() {
  const manager = new ServerManager();
  process.on('unhandledRejection', () => manager.shutdown(log));
  process.on('uncaughtException', () => manager.shutdown(log));
  const parser = makeSchemaParser<Config>(await loadSchema());

  function stop() {
    process.stdin.destroy();
    manager.shutdown(log);
  }

  async function load() {
    clearZipCache();
    const config = await loadConfig(parser, args);
    if (config.logFormat === 'json') {
      log = jsonLogger(logTarget, config.log, config.logTime);
    } else {
      log = textLogger(logTarget, config.log, config.logTime);
    }
    await loadMime(config.mime);
    if (config.writeCompressed) {
      await runCompression(config.servers, config.minCompress, log);
    }
    if (config.noServe) {
      try {
        await manager.validate(config.servers);
      } catch (error: unknown) {
        log(0, { type: 'error', message: error });
        process.stdin.destroy();
        process.exit(1);
      } finally {
        stop();
      }
    } else {
      manager.set(config.servers, config.backgroundTasks, log, (error) => {
        if (error instanceof AggregateError) {
          for (const subError of error.errors) {
            log(0, { type: 'error', message: subError });
          }
        } else {
          log(0, { type: 'error', message: error });
        }
        process.stdin.destroy();
        process.exit(1);
      });
    }
  }

  function update() {
    log(2, { message: 'refreshing config' });
    return load();
  }

  load();
  process.on('SIGHUP', () => update());
  process.stdin.on('data', (data) => {
    if (data.includes('\n')) {
      update();
    }
  });
  let stopping = false;
  process.on('SIGINT', () => {
    if (stopping) {
      return;
    }
    stopping = true;
    if (logTarget.isTTY) {
      logTarget.write('\n');
    }
    stop();
  });
}

run();
