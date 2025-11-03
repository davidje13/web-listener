import { tmpdir } from 'node:os';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import 'lean-test';

export type FilesDefinition = { [k in string]: string | FilesDefinition };

export function makeTestTempDir(prefix: string, structure?: FilesDefinition) {
  return beforeEach<string>(async ({ setParameter }) => {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    if (structure) {
      await makeFileStructure(dir, structure);
    }
    setParameter(dir);
    return () => rm(dir, { recursive: true });
  });
}

export function makeTestTempFile(prefix: string, name: string, content: string) {
  return beforeAll<string>(async ({ setParameter }) => {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    const filename = join(dir, name);
    await writeFile(filename, content);
    setParameter(filename);
    return () => rm(dir, { recursive: true });
  });
}

export async function makeFileStructure(dir: string, structure: FilesDefinition) {
  for (const [name, content] of Object.entries(structure)) {
    const fullName = join(dir, name);
    if (typeof content === 'string') {
      await writeFile(fullName, content);
    } else {
      await mkdir(fullName);
      await makeFileStructure(fullName, content);
    }
  }
}
