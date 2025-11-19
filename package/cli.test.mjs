import { rm, stat } from 'node:fs/promises';
import { text } from 'node:stream/consumers';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createServer } from 'node:net';
import { createInterface } from 'node:readline/promises';
import 'lean-test';

const selfDir = dirname(new URL(import.meta.url).pathname);
const binDir = [selfDir, 'node_modules', '.bin'];

describe('cli', () => {
  it('is available via npm/npx', { timeout: 3000 }, async ({ [TEARDOWN]: teardown }) => {
    const p = spawnProcess(
      'npm',
      ['--prefix', selfDir, 'exec', '--offline', '--', 'web-listener', '--version'],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    teardown(p.close);
    const output = await text(p.stdout);
    expect(output).matches(/^web-listener \d+\.\d+\.\d+\n$/);

    expect(p.errors).isEmpty();
  });

  it('runs with arguments', { timeout: 3000 }, async ({ [TEARDOWN]: teardown }) => {
    const [port] = await findAvailablePorts(1);

    const p = spawnProcess(
      join(...binDir, 'web-listener'),
      ['--port', String(port), '--dir', join('cli', 'sample')],
      { env: { NO_COLOR: '1' } },
    );
    teardown(p.close);
    if (!(await awaitLine(p.stderr, 'all servers ready'))) {
      fail('failed to start server');
    }

    const resFile = await fetch(`http://localhost:${port}/file.txt`);
    expect(resFile.status).equals(200);
    expect(await resFile.text()).contains('Test');

    expect(p.errors).isEmpty();
  });

  it('runs with inline configuration', { timeout: 3000 }, async ({ [TEARDOWN]: teardown }) => {
    const [port1, port2] = await findAvailablePorts(2);
    const config = {
      servers: [
        {
          port: port1,
          mount: [
            { type: 'fixture', path: '/hello', body: 'Hi' },
            { type: 'proxy', path: '/api', target: `http://localhost:${port2}/sub` },
          ],
        },
        {
          port: port2,
          mount: [{ type: 'fixture', path: '/sub/dothing', body: 'done' }],
        },
      ],
    };

    const p = spawnProcess(join(...binDir, 'web-listener'), ['-C', JSON.stringify(config)], {
      env: { NO_COLOR: '1' },
    });
    teardown(p.close);
    if (!(await awaitLine(p.stderr, 'all servers ready'))) {
      fail('failed to start server');
    }

    const resFixture = await fetch(`http://localhost:${port1}/hello`);
    expect(resFixture.status).equals(200);
    expect(await resFixture.text()).equals('Hi');

    const resProxy = await fetch(`http://localhost:${port1}/api/dothing`);
    expect(resProxy.status).equals(200);
    expect(await resProxy.text()).equals('done');

    const res404 = await fetch(`http://localhost:${port1}/nope`);
    expect(res404.status).equals(404);

    expect(p.errors).isEmpty();
  });

  it('runs with external configuration', { timeout: 3000 }, async ({ [TEARDOWN]: teardown }) => {
    const [port] = await findAvailablePorts(1);

    const p = spawnProcess(
      join(...binDir, 'web-listener'),
      ['-c', join('cli', 'sample-config.json'), '--port', String(port)],
      { env: { NO_COLOR: '1' } },
    );
    teardown(p.close);
    if (!(await awaitLine(p.stderr, 'all servers ready'))) {
      fail('failed to start server');
    }

    const resFile = await fetch(`http://localhost:${port}/file.txt`);
    expect(resFile.status).equals(200);
    expect(resFile.headers.get('content-type')).equals('text/apache; charset=utf-8');
    expect(await resFile.text()).contains('Test');

    const resFixture = await fetch(`http://localhost:${port}/config.json`);
    expect(resFixture.status).equals(200);
    expect(await resFixture.text()).equals('{"env":"local"}');

    const resRedirect = await fetch(`http://localhost:${port}/request`, { redirect: 'manual' });
    expect(resRedirect.status).equals(307);
    expect(resRedirect.headers.get('location')).equals('/other');
  });

  it('compresses content if requested', { timeout: 3000 }, async ({ [TEARDOWN]: teardown }) => {
    const compressedPath = join(selfDir, 'cli', 'sample', 'file.txt.gz');
    await rm(compressedPath).catch(() => {});
    const p = spawnProcess(
      join(...binDir, 'web-listener'),
      [
        join(selfDir, 'cli', 'sample'),
        '--write-compressed',
        '--min-compress',
        '1',
        '--gzip',
        '--no-serve',
      ],
      { stdio: ['ignore', 'inherit', 'pipe'] },
    );
    teardown(p.close);
    teardown(() => rm(compressedPath).catch(() => {}));
    const output = await text(p.stderr);
    expect(output).matches(
      /^compressing files in .* using gzip\n.*\n1 compressed file written\n$/s,
    );
    const stats = await stat(compressedPath);
    expect(stats.size).isGreaterThan(30);
    expect(stats.size).isLessThan(60);

    expect(p.errors).isEmpty();
  });

  const TEARDOWN = beforeEach(({ setParameter }) => {
    const tasks = [];
    setParameter((fn) => tasks.push(fn));
    return async () => {
      for (const task of tasks) {
        await task();
      }
    };
  });
});

async function findAvailablePorts(count = 1) {
  const servers = [];
  for (let i = 0; i < count; ++i) {
    const s = createServer();
    servers.push(s);
  }
  await Promise.all(
    servers.map(
      (s) =>
        new Promise((resolve, reject) => {
          s.once('error', reject);
          s.listen(0, 'localhost', resolve);
        }),
    ),
  );
  try {
    return servers.map((s) => s.address().port);
  } finally {
    await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  }
}

function spawnProcess(path, args, options = {}) {
  const ac = new AbortController();
  const p = spawn(path, args, {
    cwd: selfDir,
    stdio: ['ignore', 'inherit', 'pipe'],
    signal: ac.signal,
    killSignal: 'SIGINT',
    ...options,
    env: { PATH: process.env['PATH'], ...options.env },
  });
  const errors = [];
  const errorListener = (error) => errors.push(error);
  p.on('error', errorListener);
  const exited = new Promise((resolve) => p.once('exit', resolve));

  return {
    stdout: p.stdout,
    stderr: p.stderr,
    errors,
    close: () => {
      p.off('error', errorListener);
      p.on('error', () => {});
      ac.abort();
      return exited;
    },
  };
}

async function awaitLine(readable, expected) {
  const lines = createInterface(readable);
  for await (const line of lines) {
    console.log(line);
    if (line === expected) {
      // pipe all remaining output to console in the background
      (async () => {
        for await (const line of lines) {
          console.log(line);
        }
      })();
      return true;
    }
  }
  return false;
}
