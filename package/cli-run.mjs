#!/usr/bin/env -S node --disable-proto=throw --disallow-code-generation-from-strings --force-node-api-uncaught-exceptions-policy --no-addons --pending-deprecation --throw-deprecation
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';

async function runTest() {
  const port = await findAvailablePort();
  const config = { servers: [{ port, mount: [{ type: 'fixture', path: '/hello', body: 'Hi' }] }] };

  const ac = new AbortController();
  process.stderr.write('Starting CLI server...\n');
  const dir = dirname(new URL(import.meta.url).pathname);
  const p = spawn(
    join(dir, 'node_modules', '.bin', 'web-listener'),
    ['-C', JSON.stringify(config)],
    {
      cwd: dir,
      stdio: ['ignore', 'inherit', 'pipe'],
      env: { PATH: process.env['PATH'], NO_COLOR: '1' },
      signal: ac.signal,
      killSignal: 'SIGINT',
    },
  );
  try {
    if (!(await awaitLine(p.stderr, 'all servers ready'))) {
      throw new Error('failed to start server');
    }

    const res = await fetch(`http://localhost:${port}/hello`);
    if (res.status !== 200) {
      throw new Error(`unexpected response status for /hello: ${body}`);
    }
    const body = await res.text();
    if (body !== 'Hi') {
      throw new Error(`unexpected response body for /hello: ${body}`);
    }

    const res404 = await fetch(`http://localhost:${port}/nope`);
    if (res404.status !== 404) {
      throw new Error(`unexpected response status for /nope: ${body}`);
    }
    process.stderr.write('Tests passed.\n');
  } finally {
    await new Promise((resolve) => {
      process.stderr.write('Shutting down server...\n');
      p.on('error', () => {});
      p.once('exit', resolve);
      ac.abort();
    });
  }
}

runTest().catch((err) => {
  process.stderr.write(`Error: ${err}\n`);
  process.exit(1);
});

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, 'localhost', () => {
      const port = s.address().port;
      s.removeAllListeners('error');
      s.close(() => resolve(port));
    });
  });
}

async function awaitLine(readable, expected) {
  const lines = createInterface(readable);
  for await (const line of lines) {
    process.stderr.write(line + '\n');
    if (line === expected) {
      lines.resume(); // ignore all remaining output
      return true;
    }
  }
  return false;
}
