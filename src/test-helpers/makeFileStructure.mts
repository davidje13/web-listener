import { tmpdir } from 'node:os';
import { deflateRawSync } from 'node:zlib';
import { constants, mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Queue } from '../util/Queue.mts';
import { VOID_BUFFER } from '../util/voidBuffer.mts';
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

export async function writeTestZip(path: string, structure: FilesDefinition) {
  // this writes enough data for readZip to understand the contents
  // in particular, it does not write the modification time, permission flags, or crc32

  const cdItems: {
    filename: Buffer;
    pos: number;
    compression: number;
    compressedSize: number;
    uncompressedSize: number;
  }[] = [];
  const handle = await open(path, constants.O_CREAT | constants.O_WRONLY);
  try {
    const stream = handle.createWriteStream();
    let pos = 0;

    const queue = new Queue({ path: [] as string[], structure });
    for (const { path, structure } of queue) {
      for (const [name, content] of Object.entries(structure)) {
        const itemPath = [...path, name];
        let compressed = VOID_BUFFER;
        let uncompressedSize = 0;
        let compression = 0;
        let filename: Buffer;
        if (typeof content === 'string') {
          filename = Buffer.from(itemPath.join('/'), 'utf-8');
          const uncompressed = Buffer.from(content, 'utf-8');
          uncompressedSize = uncompressed.byteLength;
          if (uncompressedSize < 20) {
            compressed = uncompressed;
          } else {
            compressed = deflateRawSync(uncompressed);
            compression = 8;
          }
        } else {
          queue.push({ path: itemPath, structure: content });
          filename = Buffer.from(itemPath.join('/') + '/', 'utf-8');
        }
        cdItems.push({
          filename,
          pos,
          compression,
          compressedSize: compressed.byteLength,
          uncompressedSize,
        });
        const localFileHeader = Buffer.alloc(30);
        localFileHeader.writeUint32BE(0x504b0304, 0);
        localFileHeader.writeUint16LE(20, 4);
        localFileHeader[6] = 0x40;
        localFileHeader.writeUint16LE(compression, 8);
        localFileHeader.writeUint32LE(compressed.byteLength, 18);
        localFileHeader.writeUint32LE(uncompressedSize, 22);
        localFileHeader.writeUint16LE(filename.byteLength, 26);
        stream.write(localFileHeader);
        stream.write(filename);
        stream.write(compressed);
        pos += localFileHeader.byteLength + filename.byteLength + compressed.byteLength;
      }
    }

    const cdPos = pos;
    for (const item of cdItems) {
      const cdFileHeader = Buffer.alloc(46);
      cdFileHeader.writeUint32BE(0x504b0102, 0);
      cdFileHeader.writeUint16LE(20, 6);
      cdFileHeader[8] = 0x40;
      cdFileHeader.writeUint16LE(item.compression, 10);
      cdFileHeader.writeUint32LE(item.compressedSize, 20);
      cdFileHeader.writeUint32LE(item.uncompressedSize, 24);
      cdFileHeader.writeUint16LE(item.filename.byteLength, 28);
      cdFileHeader.writeUint32LE(item.pos, 42);
      stream.write(cdFileHeader);
      stream.write(item.filename);
      pos += cdFileHeader.byteLength + item.filename.byteLength;
    }
    const eocd = Buffer.alloc(22);
    eocd.writeUint32BE(0x504b0506, 0);
    eocd.writeUint16LE(cdItems.length, 8);
    eocd.writeUint16LE(cdItems.length, 10);
    eocd.writeUint32LE(pos - cdPos, 12);
    eocd.writeUint32LE(cdPos, 16);
    stream.write(eocd);
  } finally {
    await handle.close();
  }
}
