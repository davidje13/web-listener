import { compressFilesInDir, type CompressionInfo } from '../index.mts';
import type { ConfigServer } from './config/shape.mts';

export async function runCompression(
  servers: ConfigServer[],
  minCompress: number,
  log: (message: string) => void,
) {
  let created = 0;

  for (const server of servers) {
    for (const mount of server.mount) {
      if (mount.type === 'files') {
        const options = mount.options.negotiation.find((n) => n.type === 'encoding')?.options;
        if (!options?.length) {
          log(`skipping ${mount.dir} because no compression is configured`);
          continue;
        }
        log(`compressing files in ${mount.dir} using ${options.map((o) => o.match).join(', ')}`);
        const processed = await compressFilesInDir(mount.dir, options, minCompress);
        const textTotals = sumTotals(processed.filter(({ mime }) => mime.startsWith('text/')));
        const miscTotals = sumTotals(processed.filter(({ mime }) => !mime.startsWith('text/')));
        log(`text files:  ${bytes(textTotals.rawSize)} / ${bytes(textTotals.bestSize)} compressed`);
        log(`other files: ${bytes(miscTotals.rawSize)} / ${bytes(miscTotals.bestSize)} compressed`);
        created += textTotals.created + miscTotals.created;
      }
    }
  }

  log(`${quantity(created, 'compressed file')} written`);
}

function sumTotals(items: CompressionInfo[]) {
  return items.reduce(
    (p, n) => ({
      rawSize: p.rawSize + n.rawSize,
      bestSize: p.bestSize + n.bestSize,
      created: p.created + n.created,
    }),
    { rawSize: 0, bestSize: 0, created: 0 },
  );
}

const quantity = (value: number, singular: string, plural = singular + 's') =>
  value === 1 ? `1 ${singular}` : `${value} ${plural}`;

const bytes = (bytes: number) =>
  bytes < 2000 ? `${bytes}B`.padStart(8, ' ') : `${(bytes / 1024).toFixed(1)}kB`.padStart(8, ' ');
