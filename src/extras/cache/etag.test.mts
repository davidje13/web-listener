import { join } from 'node:path';
import { open } from 'node:fs/promises';
import { makeTestTempDir } from '../../test-helpers/makeFileStructure.mts';
import { generateStrongETag, generateWeakETag } from './etag.mts';
import 'lean-test';

describe('generateWeakETag', () => {
  it('creates a weak etag', () => {
    const tag = generateWeakETag('text/html', { mtimeMs: 1000, size: 128 });
    expect(tag).matches(/^W\/"[^"]+"$/);
  });

  it('is consistent for the same inputs', () => {
    const stats1 = { mtimeMs: 1000, size: 128, unrelated: 1 };
    const stats2 = { mtimeMs: 1000, size: 128, unrelated: 2 };
    const tag1 = generateWeakETag('text/html', stats1);
    const tag2 = generateWeakETag('text/html', stats2);
    expect(tag1).equals(tag2);
  });

  it('uses modification time, size, and encoding', () => {
    const tag = generateWeakETag('text/html', { mtimeMs: 1000, size: 128 });

    expect(generateWeakETag('text/other', { mtimeMs: 1000, size: 128 })).not(equals(tag));
    expect(generateWeakETag('text/html', { mtimeMs: 2000, size: 128 })).not(equals(tag));
    expect(generateWeakETag('text/html', { mtimeMs: 1000, size: 64 })).not(equals(tag));
  });

  it('uses a short sha256 hash of the values', () => {
    const tag = generateWeakETag('text/html', { mtimeMs: 1000, size: 128 });
    expect(tag).equals('W/"gmXgxFSTY6U7"');
  });
});

describe('generateStrongETag', () => {
  it('creates a strong etag', async ({ getTyped }) => {
    const tag = await generateStrongETag(join(getTyped(TEST_DIR), 'one.txt'));
    expect(tag).matches(/^"[^"]+"$/);
  });

  it('uses file content', async ({ getTyped }) => {
    const tag1 = await generateStrongETag(join(getTyped(TEST_DIR), 'one.txt'));
    const tag2 = await generateStrongETag(join(getTyped(TEST_DIR), 'same.txt'));
    const tag3 = await generateStrongETag(join(getTyped(TEST_DIR), 'diff.txt'));
    expect(tag2).equals(tag1);
    expect(tag3).not(equals(tag1));
  });

  it('uses a sha256 hash of the content', async ({ getTyped }) => {
    const tag = await generateStrongETag(join(getTyped(TEST_DIR), 'one.txt'));
    expect(tag).equals('"sha256-6Aaikc/D5h+DuY00TuV+PokzzM7OT7ReFIHx9WDnDrE="');
  });

  it('accepts a file handle', async ({ getTyped }) => {
    const tag = await generateStrongETag(join(getTyped(TEST_DIR), 'one.txt'));

    const handle = await open(join(getTyped(TEST_DIR), 'one.txt'), 'r');
    try {
      const handleTag = await generateStrongETag(handle);
      expect(handleTag).equals(tag);

      // re-running with the same handle produces the same result
      const handleTag2 = await generateStrongETag(handle);
      expect(handleTag2).equals(tag);
    } finally {
      handle.close().catch(() => {});
    }
  });

  const TEST_DIR = makeTestTempDir('etag-', {
    'one.txt': 'Testing',
    'same.txt': 'Testing',
    'diff.txt': 'Other',
  });
});
