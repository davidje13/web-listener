import { access, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { buffer, text } from 'node:stream/consumers';
import { pipeline } from 'node:stream/promises';
import { dirname, join } from 'node:path';
import { inflateRaw } from 'node:zlib';
import { readZip, type ZipFile } from './readZip.mts';
import type { ReadOnlyFileHandle } from '../../util/ReadOnlyFileHandle.mts';

const selfDir = dirname(new URL(import.meta.url).pathname);
const testZipDir = join(selfDir, 'test-zips');
const LONG_CONTENT =
  'test file content with repetition which should be able to compress test test test test test test test test\n';

describe('readZip', () => {
  it('identifies the full directory structure', async () => {
    const root = await readZip(join(testZipDir, 'test.zip'));
    expect(root.find(['test1.txt'])?.isDirectory).isFalse();
    expect(root.find(['test2.txt'])?.isDirectory).isFalse();
    expect(root.find(['empty.txt'])?.isDirectory).isFalse();
    expect(root.find(['test', 'a.txt'])?.isDirectory).isFalse();
    expect(root.find(['test'])?.isDirectory).isTrue();
    expect(root.find(['nope.txt'])).isUndefined();
  });

  it('provides file metadata', async () => {
    const root = await readZip(join(testZipDir, 'test.zip'));
    const f = root.find(['test2.txt']) as ZipFile;
    expect(f.filesystemPath).equals(join(testZipDir, 'test.zip', 'test2.txt'));
    expect(f.crc32).equals(0x61d1432f);
    const stats = f.stat();
    expect(stats.size).equals(17);
    expect(stats.isFile()).isTrue();
    expect(stats.isDirectory()).isFalse();
    expect(stats.mode).equals(0o100444);
    expect(stats.mtimeMs).equals(Date.parse('2026-06-27T13:53:36Z'));
    expect(stats.mtime).equals(new Date('2026-06-27T13:53:36Z'));
  });

  it('provides read streams for uncompressed content', async () => {
    const root = await readZip(join(testZipDir, 'test.zip'));
    const f = root.find(['test2.txt']) as ZipFile;
    expect(f.stat().size).equals(17);
    expect(f.crc32).equals(0x61d1432f);
    expect(f.virtual).isFalse();
    const handle = await f.open();
    try {
      const content = await text(handle.createReadStream());
      expect(content).equals('test file content');
    } finally {
      await handle.close();
    }
  });

  it('provides read streams for compressed content', async () => {
    const root = await readZip(join(testZipDir, 'test.zip'));
    const f = root.find(['test1.txt']) as ZipFile;
    expect(f.stat().size).equals(107);
    expect(f.crc32).equals(0x1e4adf82);
    expect(f.virtual).isFalse();
    const handle = await f.open();
    try {
      const content = await text(handle.createReadStream());
      expect(content).equals(LONG_CONTENT);
    } finally {
      await handle.close();
    }
  });

  it('provides virtual .deflate files for compressed content', async () => {
    const root = await readZip(join(testZipDir, 'test.zip'));
    const f = root.find(['test1.txt.deflate']) as ZipFile;
    expect(f.stat().size).equals(67);
    expect(f.crc32).equals(0x1e4adf82);
    expect(f.virtual).isTrue();
    const handle = await f.open();
    try {
      const content = await buffer(handle.createReadStream());
      const inflated = await new Promise<Buffer>((resolve, reject) =>
        inflateRaw(content, (err, result) => (err ? reject(err) : resolve(result))),
      );
      expect(inflated.toString('utf-8')).equals(LONG_CONTENT);
    } finally {
      await handle.close();
    }
  });

  it('provides read streams for empty files', async () => {
    const root = await readZip(join(testZipDir, 'test.zip'));
    const f = root.find(['empty.txt']) as ZipFile;
    expect(f.stat().size).equals(0);
    expect(f.crc32).equals(0x00000000);
    expect(f.virtual).isFalse();
    const handle = await f.open();
    try {
      const content = await text(handle.createReadStream());
      expect(content).equals('');
    } finally {
      await handle.close();
    }
  });

  it('allows reading multiple files simultaneously', async () => {
    const root = await readZip(join(testZipDir, 'test.zip'));
    const f1 = root.find(['test1.txt']) as ZipFile;
    const f2 = root.find(['test2.txt']) as ZipFile;
    let handle1: ReadOnlyFileHandle | undefined;
    let handle2: ReadOnlyFileHandle | undefined;
    let handle3: ReadOnlyFileHandle | undefined;
    try {
      handle1 = await f1.open();
      handle2 = await f1.open();
      handle3 = await f2.open();
      const stream1 = text(handle1.createReadStream());
      const stream2 = text(handle2.createReadStream());
      const stream3 = text(handle3.createReadStream());
      expect(await stream1).equals(LONG_CONTENT);
      expect(await stream2).equals(LONG_CONTENT);
      expect(await stream3).equals('test file content');
    } finally {
      await handle1?.close();
      await handle2?.close();
      await handle3?.close();
    }
  });

  it('does not close other handles if a stream errors', async () => {
    const root = await readZip(join(testZipDir, 'test.zip'));
    const f1 = root.find(['test1.txt']) as ZipFile;
    let handle1: ReadOnlyFileHandle | undefined;
    let handle2: ReadOnlyFileHandle | undefined;
    try {
      handle1 = await f1.open();
      handle2 = await f1.open();
      const stream1 = handle1.createReadStream();
      stream1.on('error', () => {});
      const stream2 = handle2.createReadStream();
      stream1.destroy(new Error('oh no'));
      expect(await text(stream2)).equals(LONG_CONTENT);
    } finally {
      await handle1?.close();
      await handle2?.close();
    }
  });

  it('supports files >= 4GB', async () => {
    // test64.zip generated with:
    // dd if=/dev/zero of=large.dat bs=1M count=4096
    // zip -X test64.zip large.dat

    const root = await readZip(join(testZipDir, 'test64.zip'));
    const f = root.find(['large.dat']) as ZipFile;
    expect(f.stat().size).equals(0x100000000);
  });

  it('supports > 65k files', async () => {
    // test65k.zip generated with:
    // for i in $(seq 256); do mkdir -p "multi/$i"; for j in $(seq 256); do touch "multi/$i/$j"; done; done
    // zip -X -r test65k.zip multi

    const root = await readZip(join(testZipDir, 'test65k.zip'));
    const files = [...root.allFiles()].map((f) => f.path.join('/'));
    expect(files.length).equals(0x10000);
  });

  beforeAll(async () => {
    // test zip files are compressed to save space in the repository - expand them for testing
    if (
      !(await access(testZipDir).then(
        () => true,
        () => false,
      ))
    ) {
      await mkdir(testZipDir);
      const data = await readZip(join(selfDir, 'test-zips.zip'));
      for (const file of data.allFiles()) {
        if (file.node.virtual) {
          continue;
        }
        if (file.path.some((p) => p.startsWith('.') || p.includes('/') || p.includes('\\') || !p)) {
          throw new Error('invalid file path in test zip');
        }
        const handle = await file.node.open();
        try {
          const target = createWriteStream(join(testZipDir, ...file.path));
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
  });
});
