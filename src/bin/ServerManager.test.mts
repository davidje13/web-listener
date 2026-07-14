import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { findAvailablePort } from '../test-helpers/findAvailablePort.mts';
import { makeTestTempDir } from '../test-helpers/makeFileStructure.mts';
import type { ConfigServer } from './config/types.mts';
import { ServerManager } from './ServerManager.mts';
import type { Logger } from './log.mts';
import 'lean-test';

describe('ServerManager', () => {
  it('launches a server based on the given config', { timeout: 3000 }, async () => {
    const port = await findAvailablePort();

    const log = testLog();
    const manager = new ServerManager();
    try {
      await manager.set([fixtureServer(port, 'content')], [], log.logger, () => fail());
      expect(log.captured).equals([
        `http://localhost:${port} starting`,
        `http://localhost:${port} ready`,
        'all servers ready',
      ]);

      const res = await fetch(`http://localhost:${port}`);
      expect(res.status).equals(200);
      expect(await res.text()).equals('content');

      expect(log.latest()).matches(/^http:\/\/localhost:\d+ GET \/ 200$/);
    } finally {
      manager.shutdown(log.logger);
    }
  });

  it('launches multiple servers', { timeout: 3000 }, async () => {
    const [port1, port2] = await Promise.all([findAvailablePort(), findAvailablePort()]);

    const log = testLog();
    const manager = new ServerManager();
    try {
      await manager.set(
        [fixtureServer(port1, 'content 1'), fixtureServer(port2, 'content 2')],
        [],
        log.logger,
        () => fail(),
      );
      expect(log.latest()).equals('all servers ready');

      const res1 = await fetch(`http://localhost:${port1}`);
      expect(await res1.text()).equals('content 1');

      const res2 = await fetch(`http://localhost:${port2}`);
      expect(await res2.text()).equals('content 2');
    } finally {
      manager.shutdown(log.logger);
    }
  });

  it('skips servers with conflicting ports', { timeout: 3000 }, async () => {
    const port = await findAvailablePort();

    const log = testLog();
    const manager = new ServerManager();
    try {
      await manager.set(
        [fixtureServer(port, 'content 1'), fixtureServer(port, 'content 2')],
        [],
        log.logger,
        () => fail(),
      );
      expect(log.captured).equals([
        `skipping servers[1] because port ${port} has already been defined`,
        `http://localhost:${port} starting`,
        `http://localhost:${port} ready`,
        'all servers ready',
      ]);

      const res = await fetch(`http://localhost:${port}`);
      expect(await res.text()).equals('content 1');
    } finally {
      manager.shutdown(log.logger);
    }
  });

  it('skips servers with invalid ports', { timeout: 3000 }, async () => {
    const log = testLog();
    const manager = new ServerManager();
    try {
      await manager.set(
        [fixtureServer(0, 'content 1'), fixtureServer(65536, 'content 2')],
        [],
        log.logger,
        () => fail(),
      );
      expect(log.captured).equals([
        'servers[0] must have a specific port from 1 to 65535',
        'servers[1] must have a specific port from 1 to 65535',
        'no servers configured',
      ]);
    } finally {
      manager.shutdown(log.logger);
    }
  });

  it('updates servers without relaunching if the config changes', { timeout: 3000 }, async () => {
    const port = await findAvailablePort();

    const log = testLog();
    const manager = new ServerManager();
    try {
      await manager.set([fixtureServer(port, 'content')], [], log.logger, () => fail());
      expect(log.captured).equals([
        `http://localhost:${port} starting`,
        `http://localhost:${port} ready`,
        'all servers ready',
      ]);

      const res1 = await fetch(`http://localhost:${port}`);
      expect(await res1.text()).equals('content');

      log.clear();
      await manager.set([fixtureServer(port, 'updated content')], [], log.logger, () => fail());
      expect(log.captured).equals([`http://localhost:${port} updated`, 'all servers ready']);

      const res2 = await fetch(`http://localhost:${port}`);
      expect(await res2.text()).equals('updated content');
    } finally {
      manager.shutdown(log.logger);
    }
  });

  it('relaunches servers if the server config changes', { timeout: 3000 }, async () => {
    const port = await findAvailablePort();

    const log = testLog();
    const manager = new ServerManager();
    try {
      await manager.set([fixtureServer(port, 'content')], [], log.logger, () => fail());
      expect(log.captured).equals([
        `http://localhost:${port} starting`,
        `http://localhost:${port} ready`,
        'all servers ready',
      ]);

      const res1 = await fetch(`http://localhost:${port}`);
      expect(await res1.text()).equals('content');

      log.clear();
      await manager.set(
        [
          {
            ...fixtureServer(port, 'updated content'),
            options: { ...DEFAULT_SERVER_OPTIONS, backlog: 300 },
          },
        ],
        [],
        log.logger,
        () => fail(),
      );
      expect(log.captured).equals([
        `http://localhost:${port} restarting (step 1: shutdown)`,
        `http://localhost:${port} closed`,
        `http://localhost:${port} restarting (step 2: start)`,
        `http://localhost:${port} ready`,
        'all servers ready',
      ]);

      const res2 = await fetch(`http://localhost:${port}`);
      expect(await res2.text()).equals('updated content');
    } finally {
      manager.shutdown(log.logger);
    }
  });

  describe('shutdown', () => {
    it('stops all servers', { timeout: 3000 }, async () => {
      const [port1, port2] = await Promise.all([findAvailablePort(), findAvailablePort()]);

      const log = testLog();
      const manager = new ServerManager();
      try {
        await manager.set(
          [fixtureServer(port1, 'content 1'), fixtureServer(port2, 'content 2')],
          [],
          log.logger,
          () => fail(),
        );
        manager.shutdown(log.logger);
        await expect.poll(() => log.latest(), equals('shutdown complete'), {
          timeout: 300,
        });

        await expect(() => fetch(`http://localhost:${port1}`)).throws('fetch failed');
        await expect(() => fetch(`http://localhost:${port2}`)).throws('fetch failed');
      } finally {
        manager.shutdown(log.logger);
      }
    });

    it('stops all servers even if some are still starting', { timeout: 3000 }, async () => {
      const [port1, port2] = await Promise.all([findAvailablePort(), findAvailablePort()]);

      const log = testLog();
      const manager = new ServerManager();
      try {
        manager.set(
          [fixtureServer(port1, 'content 1'), fixtureServer(port2, 'content 2')],
          [],
          log.logger,
          () => fail(),
        );
        manager.shutdown(log.logger);
        await expect.poll(() => log.latest(), equals('shutdown complete'), {
          timeout: 500,
        });

        await expect(() => fetch(`http://localhost:${port1}`)).throws('fetch failed');
        await expect(() => fetch(`http://localhost:${port2}`)).throws('fetch failed');
      } finally {
        manager.shutdown(log.logger);
      }
    });
  });

  const TEST_DIR = makeTestTempDir('sm-');

  it(
    'retries transient errors if an executable is running',
    { timeout: 3000 },
    async ({ getTyped }) => {
      const port = await findAvailablePort();

      const log = testLog();
      const manager = new ServerManager();
      try {
        await manager.set(
          [
            {
              port,
              host: 'localhost',
              mount: [
                { type: 'files', path: '/', dir: join(getTyped(TEST_DIR), 'sub'), options: {} },
              ],
              options: DEFAULT_SERVER_OPTIONS,
            },
          ],
          [
            {
              command: 'true',
              arguments: [],
              cwd: '.',
              environment: {},
              options: { killSignal: 'SIGTERM', displayStdout: true, displayStderr: true },
            },
          ],
          log.logger,
          () => fail(),
        );
        expect(log.captured).contains(matches(/content to serve not found/));
        expect(log.captured).not(contains(`http://localhost:${port} ready`));
        expect(log.captured).not(contains('all servers ready'));

        await mkdir(join(getTyped(TEST_DIR), 'sub'));

        await expect.poll(() => log.captured, contains('all servers ready'));
        expect(log.captured).contains(`http://localhost:${port} ready`);
      } finally {
        manager.shutdown(log.logger);
      }
    },
  );

  it(
    'does not retry transient errors if no executables are running',
    { timeout: 3000 },
    async ({ getTyped }) => {
      const port = await findAvailablePort();

      const log = testLog();
      const manager = new ServerManager();
      try {
        let errorCaptor = (_: unknown) => {};
        const awaitError = new Promise<unknown>((resolve) => {
          errorCaptor = resolve;
        });
        await manager.set(
          [
            {
              port,
              host: 'localhost',
              mount: [
                { type: 'files', path: '/', dir: join(getTyped(TEST_DIR), 'nope'), options: {} },
              ],
              options: DEFAULT_SERVER_OPTIONS,
            },
          ],
          [
            {
              command: 'true',
              arguments: [],
              cwd: '.',
              environment: {},
              options: { killSignal: 'SIGTERM', displayStdout: true, displayStderr: true },
            },
          ],
          log.logger,
          errorCaptor,
        );
        const capturedError = await awaitError;
        expect(capturedError).isInstanceOf(Error);
        expect((capturedError as Error).message).contains('content to serve not found');
        expect(log.captured).contains(matches(/content to serve not found/));
        expect(log.captured).not(contains(`http://localhost:${port} ready`));
        expect(log.captured).not(contains('all servers ready'));
      } finally {
        manager.shutdown(log.logger);
      }
    },
  );
});

const testLog = () => {
  const captured: string[] = [];
  const logger: Logger = (_, parts) =>
    captured.push(
      [parts.service, parts.method, parts.path, parts.status, parts.message]
        .filter((v) => v)
        .join(' '),
    );
  return {
    logger,
    captured,
    clear() {
      captured.length = 0;
    },
    latest() {
      return captured[captured.length - 1];
    },
  };
};

const DEFAULT_SERVER_OPTIONS = {
  backlog: 511,
  rejectNonStandardExpect: false,
  autoContinue: false,
  logRequests: true,
  restartTimeout: 2000,
  shutdownTimeout: 500,
};

const fixtureServer = (port: number, body: string): ConfigServer => ({
  port,
  host: 'localhost',
  mount: [{ type: 'fixture', method: 'GET', path: '/', status: 200, headers: {}, body }],
  options: DEFAULT_SERVER_OPTIONS,
});
