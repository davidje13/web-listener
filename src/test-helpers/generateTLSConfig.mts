import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function generateTLSConfig() {
  const dir = await mkdtemp(join(tmpdir(), 'cert-'));
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn(
        'openssl',
        [
          'req',
          '-nodes',
          '-new',
          '-x509',
          '-days',
          '1',
          '-subj',
          '/CN=*',
          '-keyout',
          'server.key',
          '-out',
          'server.crt',
        ],
        { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] },
      );
      p.once('error', reject);
      p.once('exit', (code, signal) => {
        if (code === 0) {
          resolve();
        } else {
          reject(code ?? signal);
        }
      });
    });
    return {
      key: await readFile(join(dir, 'server.key')),
      cert: await readFile(join(dir, 'server.crt')),
    };
  } finally {
    await rm(dir, { recursive: true });
  }
}
