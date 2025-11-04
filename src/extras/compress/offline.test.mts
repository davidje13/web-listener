import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTestTempDir } from '../../test-helpers/makeFileStructure.mts';
import { compressFileOffline, compressFilesInDir } from './offline.mts';
import 'lean-test';

describe('compressFileOffline', () => {
  const TEST_DIR = makeTestTempDir('compress-', {
    'compressible.txt': '.'.repeat(1000),
  });

  it('applies multiple possible compressions to a file', async ({ getTyped }) => {
    const dir = getTyped(TEST_DIR);
    const file = join(dir, 'compressible.txt');
    const stats = await compressFileOffline(
      file,
      [
        { match: 'gzip', file: '{file}.gz' },
        { match: 'brotli', file: '{file}.br' },
        { match: 'deflate', file: 'custom-{file}.deflate' },
      ],
      300,
    );

    expect(stats.file).equals(file);
    expect(stats.mime).equals('text/plain; charset=utf-8');
    expect(stats.rawSize).equals(1000);
    expect(stats.created).equals(3);
    expect(stats.bestSize).isGreaterThan(10);
    expect(stats.bestSize).isLessThan(1000);

    expect((await readdir(dir)).sort()).equals([
      'compressible.txt',
      'compressible.txt.br',
      'compressible.txt.gz',
      'custom-compressible.txt.deflate',
    ]);
  });
});

describe('compressFilesInDir', () => {
  const TEST_DIR = makeTestTempDir('compress-', {
    'compressible.txt': '.'.repeat(1000),
    'incompressible.txt': 'too small',
    'poor-compression.txt': '.'.repeat(310),
    'already-compressed.txt': 'original',
    'already-compressed.txt.gz': 'compressed',
    'image.png': '.'.repeat(1000), // not compressed even though it could be
    nested: {
      'deep.txt': '.'.repeat(1000),
    },
  });

  it('compresses files which can be reduced', async ({ getTyped }) => {
    const dir = getTyped(TEST_DIR);
    const stats = await compressFilesInDir(dir, [{ match: 'gzip', file: '{file}.gz' }], 300);
    expect(stats).hasLength(6);

    const findStat = (file: string) => stats.find((s) => s.file.endsWith(file));

    const stats0 = findStat('compressible.txt');
    expect(stats0?.created).equals(1);
    expect(stats0!.bestSize).isLessThan(stats0!.rawSize);

    const stats1 = findStat('incompressible.txt');
    expect(stats1?.created).equals(0);
    expect(stats1!.bestSize).equals(stats1!.rawSize);

    const stats2 = findStat('poor-compression.txt');
    expect(stats2?.created).equals(0);
    expect(stats2!.bestSize).equals(stats2!.rawSize);

    const stats3 = findStat('already-compressed.txt');
    expect(stats3?.created).equals(0);
    expect(stats3!.bestSize).equals(stats3!.rawSize);

    const stats4 = findStat('image.png');
    expect(stats4?.created).equals(0);
    expect(stats4!.bestSize).equals(stats4!.rawSize);

    const stats5 = findStat(join('nested', 'deep.txt'));
    expect(stats5?.created).equals(1);
    expect(stats5!.bestSize).isLessThan(stats5!.rawSize);

    expect((await readdir(dir)).sort()).equals([
      'already-compressed.txt',
      'already-compressed.txt.gz',
      'compressible.txt',
      'compressible.txt.gz',
      'image.png',
      'incompressible.txt',
      'nested',
      'poor-compression.txt',
    ]);
    expect((await readdir(join(dir, 'nested'))).sort()).equals(['deep.txt', 'deep.txt.gz']);
  });
});
