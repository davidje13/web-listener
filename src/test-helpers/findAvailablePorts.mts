import { createServer, type Server } from 'node:net';

export async function findAvailablePorts(count = 1): Promise<number[]> {
  const servers: Server[] = [];
  for (let i = 0; i < count; ++i) {
    const s = createServer();
    servers.push(s);
  }
  await Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((resolve, reject) => {
          s.once('error', reject);
          s.listen(0, 'localhost', resolve);
        }),
    ),
  );
  try {
    return servers.map((s) => {
      const addr = s.address();
      if (!addr || typeof addr === 'string') {
        throw 'unexpected address type';
      }
      return addr.port;
    });
  } finally {
    await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  }
}
