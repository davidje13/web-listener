import { access, mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { readZip } from '../extras/filesystem/readZip.mts';

export async function unpack(zipPath: string, targetPath: string) {
  // test zip archives are compressed to save space in the repository - expand them for testing
  if (
    !(await access(targetPath).then(
      () => true,
      () => false,
    ))
  ) {
    await mkdir(targetPath);
    const data = await readZip(zipPath);
    for (const file of data.allFiles()) {
      if (file.node.virtual) {
        continue;
      }
      if (file.path.some((p) => p.startsWith('.') || p.includes('/') || p.includes('\\') || !p)) {
        throw new Error('invalid file path in test zip');
      }
      const handle = await file.node.open();
      try {
        const target = createWriteStream(join(targetPath, ...file.path));
        try {
          await pipeline(handle.createReadStream(), target);
        } finally {
          target.close();
        }
      } finally {
        handle.close();
      }
    }
  }
}
