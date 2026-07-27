import { access, mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { readZip } from '../extras/filesystem/readZip.mts';

const sequential = <Args extends any[]>(
  fn: (...args: Args) => Promise<void>,
): ((...args: Args) => Promise<void>) => {
  let lock: Promise<void> | undefined;
  return async (...args) => {
    while (lock) {
      await lock;
    }
    lock = fn(...args).finally(() => {
      lock = undefined;
    });
    await lock;
  };
};

export const unpack = sequential(async (zipPath: string, targetPath: string) => {
  if (
    await access(targetPath).then(
      () => true,
      () => false,
    )
  ) {
    return;
  }

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
});
