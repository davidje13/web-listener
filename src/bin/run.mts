#!/usr/bin/env -S node --disable-proto=delete --disallow-code-generation-from-strings --force-node-api-uncaught-exceptions-policy --no-addons --experimental-import-meta-resolve
import { open, readFile } from 'node:fs/promises';
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

const originalStdErrWrite = process.stderr.write.bind(process.stderr);
const originalStdErrTTY = process.stderr.isTTY;
const STDERR = '/dev/stderr';
const LOG_TARGET_STDERR = { write: originalStdErrWrite, isTTY: originalStdErrTTY };

let logTarget: {
  write: (content: string) => void;
  isTTY?: boolean;
  close?: () => void;
} = LOG_TARGET_STDERR;
let log = textLogger(logTarget, 'progress', true);
let startup = true;

function handleError(error: unknown) {
  log(0, { type: 'error', message: error });
  if (startup) {
    // shutdown if the error occurred during startup, but not if we are already running
    // (avoid killing the process if user code has an unhandled error)
    process.stdin.destroy();
  }
}

const wrapLog =
  (level: number, type: 'error' | 'warn' | 'detail', thread: string) =>
  (content: string | Uint8Array) => {
    if (typeof content === 'string') {
      log(level, {
        type,
        thread,
        message: () =>
          content.endsWith('\n') ? content.substring(0, content.length - 1) : content,
      });
    } else {
      log(level, { type, thread, message: () => Buffer.from(content).toString('hex') });
    }
    return true;
  };

process.on('unhandledRejection', handleError);
process.on('uncaughtException', handleError);

let args: Map<string, unknown>;
try {
  args = readArgs(process.argv.slice(2));
} catch (error: unknown) {
  log(0, { type: 'error', message: error });
  process.stdin.destroy();
  process.exit(1);
}
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
  process.on('unhandledRejection', () => startup && manager.shutdown(log));
  process.on('uncaughtException', () => startup && manager.shutdown(log));
  const parser = makeSchemaParser<Config>(await loadSchema());

  function stop() {
    process.stdin.destroy();
    manager.shutdown(log);
  }

  async function load() {
    try {
      startup = true;
      clearZipCache();
      const config = await loadConfig(parser, args);

      // update log destination
      // (we re-open even if the path hasn't changed to allow log rotation on SIGHUP)
      const newLogFile = config.logFile ?? STDERR;
      const toClose = logTarget.close;
      if (newLogFile === STDERR) {
        logTarget = LOG_TARGET_STDERR;
      } else {
        const fd = await open(newLogFile, 'a', 0o640);
        const s = fd.createWriteStream();
        logTarget = {
          write: s.write.bind(s),
          close: () => s.end(() => fd.close().catch(() => {})),
        };
      }
      process.stdout.isTTY = process.stderr.isTTY = logTarget.isTTY ?? false;
      if (config.logFormat === 'json') {
        log = jsonLogger(logTarget, config.log, config.logTime);
      } else {
        log = textLogger(logTarget, config.log, config.logTime);
      }
      toClose?.();

      await loadMime(config.mime);
      if (config.writeCompressed) {
        await runCompression(config.servers, config.minCompress, log);
      }
      if (config.noServe) {
        await manager.validate(config.servers);
        stop();
      } else {
        manager.set(
          config.servers,
          config.backgroundTasks,
          (level, parts) => log(level, parts),
          (error) => {
            if (error instanceof AggregateError) {
              for (const subError of error.errors) {
                log(0, { type: 'error', message: subError });
              }
            } else {
              log(0, { type: 'error', message: error });
            }
            process.stdin.destroy();
            process.exit(1);
          },
        );
      }
    } catch (error: unknown) {
      log(0, { type: 'error', message: error });
      process.stdin.destroy();
      process.exit(1);
    } finally {
      startup = false;
    }
  }

  function update() {
    log(2, { message: 'refreshing config' });
    return load();
  }

  // wrap console.log / .warn / etc with logger
  process.stdout.write = wrapLog(2, 'detail', 'stdout');
  process.stderr.write = wrapLog(0, 'warn', 'stderr');

  load();
  process.on('SIGHUP', update);
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
    if (originalStdErrTTY) {
      originalStdErrWrite('\n');
    }
    stop();
  });
}

run();
