import { constants, type CreateReadStreamOptions } from 'node:fs/promises';
import type { BigIntStats, StatOptions, Stats, StatsBase } from 'node:fs';
import { join } from 'node:path';
import { createInflateRaw } from 'node:zlib';
import { SharedFileHandle } from '../../util/SharedFileHandle.mts';
import type { ReadOnlyFileHandle } from '../../util/ReadOnlyFileHandle.mts';
import { createSafeReadStream } from '../../util/createSafeReadStream.mts';
import { joinStreams } from '../../util/joinStreams.mts';

class ZipError extends Error {
  constructor(path: string, message: string) {
    super(`${path} is not a valid zip archive: ${message}`);
  }
}

export async function readZip(source: string): Promise<ZipDirectory> {
  const sharedHandle = new SharedFileHandle(source, constants.O_RDONLY);
  const handle = await sharedHandle.open();
  try {
    const stats = await handle.stat();
    const totalSize = stats.size;

    const tailOffset = Math.max(totalSize - 0xffff - 22 - 20, 0);
    let tail: Uint8Array | undefined;

    const getFilePart = async (start: number, size: number) => {
      if (start < 0 || start > totalSize || start + size > totalSize) {
        throw new ZipError(
          source,
          `byte range ${start}-${start + size} is not within 0-${totalSize}`,
        );
      }
      if (start >= tailOffset && tail) {
        return new Uint8Array(tail.buffer, tail.byteOffset + start - tailOffset, size);
      }
      const out = new Uint8Array(size);
      const { bytesRead } = await handle.read(out, 0, size, start);
      if (bytesRead !== size) {
        throw new ZipError(source, 'modified while reading');
      }
      return out;
    };

    tail = await getFilePart(tailOffset, totalSize - tailOffset);
    const tailLength = tail.byteLength;
    const maxCommentSize = Math.min(0xffff, tailLength - 22);
    let commentSize = -1;
    for (let s = 0; s < maxCommentSize; ++s) {
      if (
        read16LE(tail, tailLength - s - 2) === s &&
        read32BE(tail, tailLength - s - 22) === 0x504b0506
      ) {
        commentSize = s;
        break;
      }
    }
    if (commentSize === -1) {
      throw new ZipError(source, 'no EOCD found');
    }
    const eocdOffset = totalSize - commentSize - 22;
    const eocd = sub(tail, eocdOffset - tailOffset, 22);
    let cdTotalRecords = read16LE(eocd, 10);
    let cdTotalBytes = read32LE(eocd, 12);
    let cdOffset = read32LE(eocd, 16);
    if (
      (cdTotalRecords === 0xffff || cdTotalBytes === 0xffffffff || cdOffset === 0xffffffff) &&
      eocdOffset >= tailOffset + 20
    ) {
      const eocdl = sub(tail, eocdOffset - tailOffset - 20, 20);
      if (read32BE(eocdl, 0) !== 0x504b0607) {
        throw new ZipError(source, 'missing EOCDL in 64-bit zip');
      }
      const eocd64Offset = read64LE(eocdl, 8);
      const eocd64 = await getFilePart(eocd64Offset, 56);
      if (read32BE(eocd64, 0) !== 0x504b0606) {
        throw new ZipError(source, 'EOCD64 is invalid');
      }
      cdTotalRecords = read64LE(eocd64, 32);
      cdTotalBytes = read64LE(eocd64, 40);
      cdOffset = read64LE(eocd64, 48);
    }

    const root = new ZipDirectory(source, []);

    const cd = await getFilePart(cdOffset, cdTotalBytes);
    let pos = 0;
    for (let i = 0; i < cdTotalRecords; ++i) {
      if (read32BE(cd, pos) !== 0x504b0102) {
        throw new ZipError(source, `missing CDFH for record #${i + 1} at 0x${pos.toString(16)}`);
      }
      const bitFlag = read16LE(cd, pos + 8);
      const isUTF8 = Boolean(bitFlag & 0b00000100_00000000);
      const compression = read16LE(cd, pos + 10);
      if (compression !== 0 && compression !== 8) {
        throw new ZipError(source, `unsupported compression type: ${compression}`);
      }
      let modified = readDOSTimeDate(read16LE(cd, pos + 12), read16LE(cd, pos + 14));
      const crc32 = read32LE(cd, pos + 16);
      let compressedSize = read32LE(cd, pos + 20);
      let uncompressedSize = read32LE(cd, pos + 24);
      const nameLength = read16LE(cd, pos + 28);
      const extraFieldLength = read16LE(cd, pos + 30);
      const commentLength = read16LE(cd, pos + 32);
      let localHeaderOffset = read32LE(cd, pos + 42);
      const nameBytes = sub(cd, pos + 46, nameLength);
      let fileName = isUTF8 ? utf8(nameBytes) : [...nameBytes].map((v) => CP437[v]).join('');
      const extra = sub(cd, pos + 46 + nameLength, extraFieldLength);
      pos += 46 + nameLength + extraFieldLength + commentLength;

      for (let extPos = 0; extPos < extraFieldLength;) {
        const size = read16LE(extra, extPos + 2);
        const field = sub(extra, extPos + 4, size);
        switch (read16LE(extra, extPos)) {
          case 0x0001: {
            // zip64
            let o = 0;
            if (uncompressedSize === 0xffffffff) {
              uncompressedSize = read64LE(field, o);
              o += 8;
            }
            if (compressedSize === 0xffffffff) {
              compressedSize = read64LE(field, o);
              o += 8;
            }
            if (localHeaderOffset === 0xffffffff) {
              localHeaderOffset = read64LE(field, o);
              o += 8;
            }
            break;
          }
          case 0x5455: {
            // unix timestamp
            const bits = field[0]!;
            if (bits & 0b00000001) {
              // note: this will suffer from rollover in 2038 (signed) or 2106 (unsigned)
              modified = read32LE(field, 1) * 1000;
            }
            break;
          }
          case 0x7075: {
            // unicode path
            fileName = utf8(sub(field, 5, field.byteLength - 5));
            break;
          }
        }
        extPos += size + 4;
      }
      if (fileName.startsWith('__MACOSX/')) {
        continue;
      }
      const path = fileName.split('/'); // zip format requires forward slashes regardless of host OS
      if (!path[path.length - 1]) {
        root._append(new ZipDirectory(source, path.slice(0, path.length - 1)));
        continue;
      }
      const localHeader = await getFilePart(localHeaderOffset, 30);
      if (read32BE(localHeader, 0) !== 0x504b0304) {
        throw new ZipError(source, `invalid local header for ${fileName}`);
      }
      const localNameLength = read16LE(localHeader, 26);
      const localExraLength = read16LE(localHeader, 28);
      const localHeaderSize = 30 + localNameLength + localExraLength;
      if (
        localHeaderOffset < 0 ||
        localHeaderOffset + localHeaderSize + compressedSize > totalSize
      ) {
        throw new ZipError(source, `invalid location for ${fileName}`);
      }

      const details: ZipFileDetails = {
        _dataOffset: localHeaderOffset + localHeaderSize,
        _compressedSize: compressedSize,
        _uncompressedSize: uncompressedSize,
        _modified: modified,
        _crc32: crc32,
      };

      if (compression === 8) {
        root._append(new ZipFile(sharedHandle, path, details, true, false));
        const deflateRawPath = [...path];
        deflateRawPath[deflateRawPath.length - 1] += '.deflate-raw';
        root._append(new ZipFile(sharedHandle, deflateRawPath, details, false, true));
        const gzipPath = [...path];
        gzipPath[gzipPath.length - 1] += '.gz';
        const gzipSuffix = Buffer.alloc(8);
        gzipSuffix.writeUint32LE(crc32, 0); // zip and gzip use same CRC32
        gzipSuffix.writeUint32LE(uncompressedSize >>> 0, 4);
        root._append(
          new ZipFile(sharedHandle, gzipPath, details, false, true, [GZIP_HEADER, gzipSuffix]),
        );
      } else {
        root._append(new ZipFile(sharedHandle, path, details, false, false));
      }
    }
    return root;
  } finally {
    await handle.close();
  }
}

class ZipDirectory {
  declare public readonly zipFilePath: string;
  /** @internal */ declare readonly _path: string[];
  declare public readonly children: Map<string, ZipNode>;

  /** @internal */ constructor(zipFilePath: string, path: string[]) {
    this.zipFilePath = zipFilePath;
    this._path = path;
    this.children = new Map();
  }

  get isDirectory(): true {
    return true;
  }

  get virtual(): false {
    return false;
  }

  get filesystemPath(): string {
    return join(this.zipFilePath, ...this._path);
  }

  /** @internal */ _append(entity: ZipNode) {
    const path = entity._path;
    let cur: ZipDirectory = this;
    for (let i = 0; i < path.length - 1; ++i) {
      const part = path[i]!;
      let next = cur.children.get(part);
      if (!next || next.virtual) {
        next = new ZipDirectory(this.zipFilePath, path.slice(0, i + 1));
        cur.children.set(part, next);
      } else if (!next.isDirectory) {
        if (entity.virtual) {
          return;
        }
        throw new ZipError(this.zipFilePath, `mix of file and directory at ${path.join('/')}`);
      }
      cur = next;
    }
    const name = path[path.length - 1]!;
    const existing = cur.children.get(name);
    if (existing && !existing.virtual) {
      if (entity.virtual) {
        return;
      }
      if (existing.isDirectory !== entity.isDirectory) {
        throw new ZipError(this.zipFilePath, `mix of file and directory at ${path.join('/')}`);
      } else {
        throw new ZipError(this.zipFilePath, `duplicate file/directory at ${path.join('/')}`);
      }
    }
    cur.children.set(name, entity);
  }

  *allFiles(
    /** @internal */ prefix: string[] = [],
  ): Generator<{ path: string[]; node: ZipFile }, undefined, undefined> {
    for (const [name, child] of this.children) {
      if (child.isDirectory) {
        yield* child.allFiles([...prefix, name]);
      } else {
        yield { path: [...prefix, name], node: child };
      }
    }
  }

  find(path: ReadonlyArray<string>) {
    let cur: ZipNode = this;
    for (const part of path) {
      if (!cur.isDirectory) {
        return undefined;
      }
      const next: ZipNode | undefined = cur.children.get(part);
      if (!next) {
        return undefined;
      }
      cur = next;
    }
    return cur;
  }
}

interface ZipFileDetails {
  /** @internal */ readonly _dataOffset: number;
  /** @internal */ readonly _compressedSize: number;
  /** @internal */ readonly _uncompressedSize: number;
  /** @internal */ readonly _modified: number;
  /** @internal */ readonly _crc32: number;
}

class ZipFile {
  /** @internal */ declare private readonly _source: SharedFileHandle;
  /** @internal */ declare readonly _path: ReadonlyArray<string>;
  /** @internal */ declare private readonly _details: ZipFileDetails;
  /** @internal */ declare private readonly _inflate: boolean;
  /** @internal */ declare private readonly _wrapper: [Buffer, Buffer] | undefined;
  declare public readonly virtual: boolean;

  /** @internal */ constructor(
    source: SharedFileHandle,
    path: ReadonlyArray<string>,
    details: ZipFileDetails,
    inflate: boolean,
    virtual: boolean,
    wrapper?: [Buffer, Buffer],
  ) {
    this._path = path;
    this._source = source;
    this._details = details;
    this._inflate = inflate;
    this.virtual = virtual;
    this._wrapper = wrapper;
  }

  get isDirectory(): false {
    return false;
  }

  get zipFilePath(): string {
    return this._source.path;
  }

  /** @internal */ meta() {
    // this is not an official API, but is needed by the CLI to load zip contents synchronously (for compatibility with the Node.js loader hooks API)
    return { p: this._details._dataOffset, z: this._inflate, s: this._details._compressedSize };
  }

  get filesystemPath(): string {
    return join(this._source.path, ...this._path);
  }

  get crc32(): number {
    return this._details._crc32;
  }

  /** @internal */ private _seekableSize() {
    return (
      this._details._compressedSize +
      (this._wrapper ? this._wrapper[0].byteLength + this._wrapper[1].byteLength : 0)
    );
  }

  stat(opts?: (StatOptions & { bigint?: false | undefined }) | undefined): Stats;
  stat(opts: StatOptions & { bigint: true }): BigIntStats;
  stat(opts?: StatOptions | undefined): Stats | BigIntStats;

  stat({ bigint = false }: StatOptions = {}): Stats & BigIntStats {
    const map = (v: number) => (bigint ? BigInt(v) : v);
    const data: Record<string | symbol, unknown> & Partial<StatsBase<number | bigint>> = {
      isFile: () => true,
      mode: map(0o100444),
      size: map(this._inflate ? this._details._uncompressedSize : this._seekableSize()),
      mtimeMs: map(this._details._modified),
      mtime: new Date(this._details._modified),
    };
    return new Proxy({} as Stats & BigIntStats, {
      get: (_, p) =>
        data[p] ??
        // fill in all other values as 0/falsy
        (typeof p !== 'string'
          ? undefined
          : p.startsWith('is')
            ? () => false
            : p.endsWith('time')
              ? new Date(0)
              : p.endsWith('Instant')
                ? undefined // requires Node.js 26+, but we currently support Node.js 22+
                : map(0)),
    });
  }

  async open(): Promise<ReadOnlyFileHandle> {
    const seekableSize = this._seekableSize();
    const stat = (options?: StatOptions | undefined): Promise<Stats & BigIntStats> =>
      Promise.resolve(this.stat(options) as Stats & BigIntStats);

    if (!seekableSize) {
      return {
        noRandomAccess: this._inflate,
        createReadStream: ({ start = 0, end, ...options } = {}) => {
          if (start !== 0) {
            throw new RangeError(`invalid byte range ${start}-${end}`);
          }
          return joinStreams({ ...options, encoding: options.encoding ?? undefined });
        },
        stat,
        close: () => Promise.resolve(),
        [Symbol.asyncDispose]: () => Promise.resolve(),
      };
    }

    const handle = await this._source.open();
    const l = this._details._compressedSize;

    const openFileStream = (
      start: number,
      end: number,
      options: Omit<CreateReadStreamOptions, 'start' | 'end'>,
    ) =>
      createSafeReadStream(handle, {
        ...options,
        start: this._details._dataOffset + Math.max(start, 0),
        end: this._details._dataOffset + Math.min(end, l - 1),
      });

    return {
      noRandomAccess: this._inflate,
      createReadStream: ({ start = 0, end = seekableSize - 1, ...options } = {}) => {
        if (this._inflate) {
          if (start !== 0) {
            throw new RangeError('start offset must be 0 for compressed files');
          }
          const s = openFileStream(0, seekableSize - 1, {
            ...options,
            highWaterMark: undefined,
            encoding: undefined,
          }).compose(createInflateRaw({ chunkSize: options.highWaterMark }));
          if (options.encoding) {
            s.setEncoding(options.encoding);
          }
          return s;
        }
        if (start < 0 || end < start || end >= seekableSize) {
          throw new RangeError(`invalid byte range ${start}-${end}`);
        }
        const w = this._wrapper;
        const dataBegin = w ? w[0].byteLength : 0;
        const suffixBegin = dataBegin + l;
        return joinStreams(
          { ...options, encoding: options.encoding ?? undefined },
          w && start < dataBegin ? w[0].subarray(start, end + 1) : null,
          start < suffixBegin && end >= dataBegin && l
            ? () => openFileStream(start - dataBegin, end - dataBegin, options)
            : null,
          w && end >= suffixBegin
            ? w[1].subarray(Math.max(start - suffixBegin, 0), end + 1 - suffixBegin)
            : null,
        );
      },
      stat,
      close: handle.close,
      [Symbol.asyncDispose]: handle.close,
    };
  }
}

export type { ZipFile, ZipDirectory };
export type ZipNode = ZipDirectory | ZipFile;

const CP437 =
  '\x00\u263A\u263B\u2665\u2666\u2663\u2660\u2022\u25D8\u25CB\u25D9\u2642\u2640\u266A\u266B\u263C\u25BA\u25C4\u2195\u203C\xB6\xA7\u25AC\u21A8\u2191\u2193\u2192\u2190\u221F\u2194\u25B2\u25BC !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\u2302\xC7\xFC\xE9\xE2\xE4\xE0\xE5\xE7\xEA\xEB\xE8\xEF\xEE\xEC\xC4\xC5\xC9\xE6\xC6\xF4\xF6\xF2\xFB\xF9\xFF\xD6\xDC\xA2\xA3\xA5\u20A7\u0192\xE1\xED\xF3\xFA\xF1\xD1\xAA\xBA\xBF\u2310\xAC\xBD\xBC\xA1\xAB\xBB\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255D\u255C\u255B\u2510\u2514\u2534\u252C\u251C\u2500\u253C\u255E\u255F\u255A\u2554\u2569\u2566\u2560\u2550\u256C\u2567\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256B\u256A\u2518\u250C\u2588\u2584\u258C\u2590\u2580\u03B1\xDF\u0393\u03C0\u03A3\u03C3\xB5\u03C4\u03A6\u0398\u03A9\u03B4\u221E\u03C6\u03B5\u2229\u2261\xB1\u2265\u2264\u2320\u2321\xF7\u2248\xB0\u2219\xB7\u221A\u207F\xB2\u25A0\xA0';

const GZIP_HEADER = /*@__PURE__*/ Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0xff]);

const readDOSTimeDate = (time: number, date: number) =>
  Date.UTC(
    1980 + ((date >>> 9) & 127), // 7bit
    ((date >>> 5) & 15) - 1, // 4bit
    (date >>> 0) & 31, // 5bit
    (time >>> 11) & 31, // 5bit
    (time >>> 5) & 63, // 6bit
    ((time >>> 0) & 31) << 1, // 5bit
    0,
  );
const exactDowncast = (v: bigint) => {
  if (v > Number.MAX_SAFE_INTEGER || v < Number.MIN_SAFE_INTEGER) {
    throw new RangeError(`unsupported size (limited to ${Number.MAX_SAFE_INTEGER})`);
  }
  return Number(v);
};
const read16LE = (data: Uint8Array, pos: number) => (data[pos + 1]! << 8) | data[pos]!;
const read32LE = (data: Uint8Array, pos: number) =>
  ((data[pos + 3]! << 24) | (data[pos + 2]! << 16) | (data[pos + 1]! << 8) | data[pos]!) >>> 0;
const read64LE = (data: Uint8Array, pos: number) =>
  exactDowncast((BigInt(read32LE(data, pos + 4)) << 32n) | BigInt(read32LE(data, pos)));
const sub = (data: Uint8Array, pos: number, bytes: number) =>
  new Uint8Array(data.buffer, data.byteOffset + pos, bytes);
const utf8 = (data: Uint8Array) => new TextDecoder('utf-8').decode(data);

const read32BE = (data: Uint8Array, pos: number) =>
  ((data[pos]! << 24) | (data[pos + 1]! << 16) | (data[pos + 2]! << 8) | data[pos + 3]!) >>> 0;
