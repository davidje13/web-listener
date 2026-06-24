import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { findAvailablePort } from '../test-helpers/findAvailablePort.mts';
import { makeTestTempDir } from '../test-helpers/makeFileStructure.mts';
import type { ConfigServer } from './config/types.mts';
import type { AddColour } from './log.mts';
import { ServerManager } from './ServerManager.mts';
import 'lean-test';

describe('ServerManager', () => {
  it('launches a server based on the given config', { timeout: 3000 }, async () => {
    const port = await findAvailablePort();

    const logs: string[] = [];
    const manager = new ServerManager((_, msg) => logs.push(msg), NO_COLOUR);
    try {
      await manager.set([fixtureServer(port, 'content')], [], () => fail());
      expect(logs).equals([
        `http://localhost:${port} starting`,
        `http://localhost:${port} ready`,
        'all servers ready',
      ]);

      const res = await fetch(`http://localhost:${port}`);
      expect(res.status).equals(200);
      expect(await res.text()).equals('content');

      expect(logs[logs.length - 1]).matches(/^http:\/\/localhost:\d+ GET \/ 200 \(\d+ms\)$/);
    } finally {
      manager.shutdown();
    }
  });

  it('launches multiple servers', { timeout: 3000 }, async () => {
    const [port1, port2] = await Promise.all([findAvailablePort(), findAvailablePort()]);

    const logs: string[] = [];
    const manager = new ServerManager((_, msg) => logs.push(msg), NO_COLOUR);
    try {
      await manager.set(
        [fixtureServer(port1, 'content 1'), fixtureServer(port2, 'content 2')],
        [],
        () => fail(),
      );
      expect(logs[logs.length - 1]).equals('all servers ready');

      const res1 = await fetch(`http://localhost:${port1}`);
      expect(await res1.text()).equals('content 1');

      const res2 = await fetch(`http://localhost:${port2}`);
      expect(await res2.text()).equals('content 2');
    } finally {
      manager.shutdown();
    }
  });

  it('skips servers with conflicting ports', { timeout: 3000 }, async () => {
    const port = await findAvailablePort();

    const logs: string[] = [];
    const manager = new ServerManager((_, msg) => logs.push(msg), NO_COLOUR);
    try {
      await manager.set(
        [fixtureServer(port, 'content 1'), fixtureServer(port, 'content 2')],
        [],
        () => fail(),
      );
      expect(logs).equals([
        `skipping servers[1] because port ${port} has already been defined`,
        `http://localhost:${port} starting`,
        `http://localhost:${port} ready`,
        'all servers ready',
      ]);

      const res = await fetch(`http://localhost:${port}`);
      expect(await res.text()).equals('content 1');
    } finally {
      manager.shutdown();
    }
  });

  it('skips servers with invalid ports', { timeout: 3000 }, async () => {
    const logs: string[] = [];
    const manager = new ServerManager((_, msg) => logs.push(msg), NO_COLOUR);
    try {
      await manager.set(
        [fixtureServer(0, 'content 1'), fixtureServer(65536, 'content 2')],
        [],
        () => fail(),
      );
      expect(logs).equals([
        'servers[0] must have a specific port from 1 to 65535',
        'servers[1] must have a specific port from 1 to 65535',
        'no servers configured',
      ]);
    } finally {
      manager.shutdown();
    }
  });

  it('updates servers without relaunching if the config changes', { timeout: 3000 }, async () => {
    const port = await findAvailablePort();

    const logs: string[] = [];
    const manager = new ServerManager((_, msg) => logs.push(msg), NO_COLOUR);
    try {
      await manager.set([fixtureServer(port, 'content')], [], () => fail());
      expect(logs).equals([
        `http://localhost:${port} starting`,
        `http://localhost:${port} ready`,
        'all servers ready',
      ]);

      const res1 = await fetch(`http://localhost:${port}`);
      expect(await res1.text()).equals('content');

      logs.length = 0;
      await manager.set([fixtureServer(port, 'updated content')], [], () => fail());
      expect(logs).equals([`http://localhost:${port} updated`, 'all servers ready']);

      const res2 = await fetch(`http://localhost:${port}`);
      expect(await res2.text()).equals('updated content');
    } finally {
      manager.shutdown();
    }
  });

  it('relaunches servers if the server config changes', { timeout: 3000 }, async () => {
    const port = await findAvailablePort();

    const logs: string[] = [];
    const manager = new ServerManager((_, msg) => logs.push(msg), NO_COLOUR);
    try {
      await manager.set([fixtureServer(port, 'content')], [], () => fail());
      expect(logs).equals([
        `http://localhost:${port} starting`,
        `http://localhost:${port} ready`,
        'all servers ready',
      ]);

      const res1 = await fetch(`http://localhost:${port}`);
      expect(await res1.text()).equals('content');

      logs.length = 0;
      await manager.set(
        [
          {
            ...fixtureServer(port, 'updated content'),
            options: { ...DEFAULT_SERVER_OPTIONS, backlog: 300 },
          },
        ],
        [],
        () => fail(),
      );
      expect(logs).equals([
        `http://localhost:${port} restarting (step 1: shutdown)`,
        `http://localhost:${port} closed`,
        `http://localhost:${port} restarting (step 2: start)`,
        `http://localhost:${port} ready`,
        'all servers ready',
      ]);

      const res2 = await fetch(`http://localhost:${port}`);
      expect(await res2.text()).equals('updated content');
    } finally {
      manager.shutdown();
    }
  });

  describe('shutdown', () => {
    it('stops all servers', { timeout: 3000 }, async () => {
      const [port1, port2] = await Promise.all([findAvailablePort(), findAvailablePort()]);

      const logs: string[] = [];
      const manager = new ServerManager((_, msg) => logs.push(msg), NO_COLOUR);
      try {
        await manager.set(
          [fixtureServer(port1, 'content 1'), fixtureServer(port2, 'content 2')],
          [],
          () => fail(),
        );
        manager.shutdown();
        await expect.poll(() => logs[logs.length - 1], equals('shutdown complete'), {
          timeout: 300,
        });

        await expect(() => fetch(`http://localhost:${port1}`)).throws('fetch failed');
        await expect(() => fetch(`http://localhost:${port2}`)).throws('fetch failed');
      } finally {
        manager.shutdown();
      }
    });

    it('stops all servers even if some are still starting', { timeout: 3000 }, async () => {
      const [port1, port2] = await Promise.all([findAvailablePort(), findAvailablePort()]);

      const logs: string[] = [];
      const manager = new ServerManager((_, msg) => logs.push(msg), NO_COLOUR);
      try {
        manager.set(
          [fixtureServer(port1, 'content 1'), fixtureServer(port2, 'content 2')],
          [],
          () => fail(),
        );
        manager.shutdown();
        await expect.poll(() => logs[logs.length - 1], equals('shutdown complete'), {
          timeout: 500,
        });

        await expect(() => fetch(`http://localhost:${port1}`)).throws('fetch failed');
        await expect(() => fetch(`http://localhost:${port2}`)).throws('fetch failed');
      } finally {
        manager.shutdown();
      }
    });
  });

  const TEST_DIR = makeTestTempDir('sm-');

  it(
    'retries transient errors if an executable is running',
    { timeout: 3000 },
    async ({ getTyped }) => {
      const port = await findAvailablePort();

      const logs: string[] = [];
      const manager = new ServerManager((_, msg) => logs.push(msg), NO_COLOUR);
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
          () => fail(),
        );
        expect(logs).contains(matches(/directory to serve not found/));
        expect(logs).not(contains(`http://localhost:${port} ready`));
        expect(logs).not(contains('all servers ready'));

        await mkdir(join(getTyped(TEST_DIR), 'sub'));

        await expect.poll(() => logs, contains('all servers ready'));
        expect(logs).contains(`http://localhost:${port} ready`);
      } finally {
        manager.shutdown();
      }
    },
  );

  it(
    'does not retry transient errors if no executables are running',
    { timeout: 3000 },
    async ({ getTyped }) => {
      const port = await findAvailablePort();

      const logs: string[] = [];
      const manager = new ServerManager((_, msg) => logs.push(msg), NO_COLOUR);
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
          errorCaptor,
        );
        const capturedError = await awaitError;
        expect(capturedError).isInstanceOf(Error);
        expect((capturedError as Error).message).contains('directory to serve not found');
        expect(logs).contains(matches(/directory to serve not found/));
        expect(logs).not(contains(`http://localhost:${port} ready`));
        expect(logs).not(contains('all servers ready'));
      } finally {
        manager.shutdown();
      }
    },
  );
});

const NO_COLOUR: AddColour = (_, message) => message;

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
