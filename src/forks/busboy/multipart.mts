import { Readable, Writable, type ReadableOptions, type WritableOptions } from 'node:stream';
import type { Decoder } from '../../util/DecoderStream.mts';
import { HTTPError } from '../../core/HTTPError.mts';
import { getTextDecoder } from '../../extras/registries/charset.mts';
import { StreamSearch } from '../streamsearch/sbmh.mts';
import {
  LATIN1,
  parseContentType,
  parseDisposition,
  TOKEN,
  type ContentTypeParams,
} from './utils.mts';
import type { BusboyOptions } from './types.mts';

export class Multipart extends Writable {
  /** @internal */ declare _bparser: Pick<StreamSearch, 'push' | 'destroy'>;
  /** @internal */ declare _writecb: (() => void) | undefined;
  /** @internal */ declare _fileStream: FileStream | undefined;
  /** @internal */ declare _complete: boolean;
  /** @internal */ declare _hparser: HeaderParser | undefined;
  /** @internal */ declare _fileEndsLeft: number;
  /** @internal */ declare _finalcb: (() => void) | undefined;

  constructor(
    {
      limits = {},
      preservePath,
      highWaterMark,
      fileHwm,
      defParamCharset = 'utf-8',
      defCharset = 'utf-8',
    }: BusboyOptions,
    conTypeParams: ContentTypeParams,
  ) {
    super({
      autoDestroy: true,
      emitClose: true,
      highWaterMark,
      // use constructor form of registering internal methods to avoid issues with names being mangled due to starting with _
      write,
      destroy,
      final,
    } as WritableOptions<Writable>);

    const boundary = conTypeParams.get('boundary');
    if (!boundary) {
      throw new HTTPError(400, { body: 'Multipart: Boundary not found' });
    }
    const paramDecoder = getTextDecoder(defParamCharset);
    const fileOpts = { autoDestroy: true, emitClose: true, highWaterMark: fileHwm };

    const fieldSizeLimit = limits.fieldSize ?? 1 * 1024 * 1024;
    const fileSizeLimit = limits.fileSize ?? Number.POSITIVE_INFINITY;
    const fieldNameSizeLimit = limits.fieldNameSize ?? 100;
    const filesLimit = limits.files ?? Number.POSITIVE_INFINITY;
    const fieldsLimit = limits.fields ?? Number.POSITIVE_INFINITY;
    const partsLimit = limits.parts ?? Number.POSITIVE_INFINITY;

    let parts = -1; // Account for initial boundary
    let fields = 0;
    let files = 0;
    let skipPart = false;

    this._fileEndsLeft = 0;
    this._complete = false;
    let fileSize = 0;

    let field: string[] | undefined;
    let fieldSize = 0;
    let partDecoder: Decoder;
    let partEncoding: string;
    let partType: string;
    let partName: string | undefined;
    let nameTruncated = false;
    let partTruncated = false;

    let hitFilesLimit = false;
    let hitFieldsLimit = false;

    const hparser = new HeaderParser((header) => {
      this._hparser = undefined;
      skipPart = false;
      partType = 'text/plain';
      let partCharset = defCharset;
      partEncoding = '7bit';
      partName = undefined;
      nameTruncated = false;
      partTruncated = false;
      let filename: string | undefined;
      const disposition = header['content-disposition']?.[0];
      if (!disposition) {
        skipPart = true;
        return;
      }
      const disp = parseDisposition(disposition, paramDecoder);
      if (disp?.type !== 'form-data') {
        skipPart = true;
        return;
      }
      if (disp.params) {
        partName = disp.params.get('name') ?? '';
        if (partName.length > fieldNameSizeLimit) {
          partName = partName.substring(0, fieldNameSizeLimit);
          nameTruncated = true;
        }
        filename = disp.params.get('filename*') ?? disp.params.get('filename');
        if (filename !== undefined && !preservePath) {
          filename = osIndependentBasename(filename);
        }
      }
      const contentType = header['content-type']?.[0];
      if (contentType) {
        const conType = parseContentType(LATIN1.decode(contentType));
        if (conType) {
          partType = conType.mime;
          partCharset = conType.params.get('charset')?.toLowerCase() ?? defCharset;
        }
      }
      partDecoder = getTextDecoder(partCharset);
      const contentTransferEncoding = header['content-transfer-encoding']?.[0];
      if (contentTransferEncoding) {
        partEncoding = LATIN1.decode(contentTransferEncoding).toLowerCase();
      }
      if (partType === 'application/octet-stream' || filename !== undefined) {
        // File
        if (files === filesLimit) {
          if (!hitFilesLimit) {
            hitFilesLimit = true;
            this.emit('filesLimit');
          }
          skipPart = true;
          return;
        }
        ++files;
        if (this.listenerCount('file') === 0) {
          skipPart = true;
          return;
        }
        fileSize = 0;
        this._fileStream = new FileStream(fileOpts, this);
        ++this._fileEndsLeft;
        this.emit('file', partName, this._fileStream, {
          nameTruncated,
          filename,
          encoding: partEncoding,
          mimeType: partType,
        });
      } else {
        // Non-file
        if (fields === fieldsLimit) {
          if (!hitFieldsLimit) {
            hitFieldsLimit = true;
            this.emit('fieldsLimit');
          }
          skipPart = true;
          return;
        }
        ++fields;
        if (this.listenerCount('field') === 0) {
          skipPart = true;
          return;
        }
        field = [];
        fieldSize = 0;
      }
    });

    let matchPostBoundary = 0;
    const needle = Buffer.from(`\r\n--${boundary}`, 'latin1');
    this._bparser = new StreamSearch(needle, (isMatch, data, start, end, isDataSafe) => {
      const safeData = (start: number, end: number) => {
        if (isDataSafe) {
          return data.subarray(start, end);
        }
        const chunk = Buffer.allocUnsafe(end - start);
        data.copy(chunk, 0, start, end);
        return chunk;
      };

      while (start !== end) {
        if (this._hparser) {
          const ret = this._hparser.push(data, start, end, isDataSafe);
          if (ret === -1) {
            this._hparser = undefined;
            hparser.reset();
            this.emit('error', new Error('Malformed part header'));
            break;
          }
          if (ret === end) {
            break;
          }
          start = ret;
        }
        if (matchPostBoundary) {
          if (matchPostBoundary === 1) {
            switch (data[start]) {
              case 45: // '-'
                // Try matching '--' after boundary
                matchPostBoundary = 2;
                ++start;
                break;
              case 13: // '\r'
                // Try matching CR LF before header
                matchPostBoundary = 3;
                ++start;
                break;
              default:
                matchPostBoundary = 0;
            }
            if (start === end) {
              return;
            }
          }
          if (matchPostBoundary === 2) {
            matchPostBoundary = 0;
            if (data[start] === 45 /* '-' */) {
              // End of multipart data
              this._complete = true;
              this._bparser = IGNORE_DATA;
              return;
            }
            // We saw something other than '-', so this section is invalid and will be ignored
          } else if (matchPostBoundary === 3) {
            matchPostBoundary = 0;
            if (data[start] === 10 /* '\n' */) {
              ++start;
              if (parts >= partsLimit) {
                break;
              }
              // Prepare the header parser
              this._hparser = hparser;
              // Process the remaining data as a header
              continue;
            } else {
              // We saw something other than LF, so this section is invalid and will be ignored
            }
          }
        }
        if (!skipPart) {
          if (this._fileStream) {
            const chunk = safeData(start, Math.min(end, start + fileSizeLimit - fileSize));
            fileSize += chunk.byteLength;
            if (fileSize === fileSizeLimit) {
              if (chunk.length > 0) {
                this._fileStream.push(chunk);
              }
              this._fileStream.emit('limit');
              this._fileStream.truncated = true;
              skipPart = true;
            } else if (!this._fileStream.push(chunk)) {
              if (this._writecb) {
                this._fileStream._readcb = this._writecb;
              }
              this._writecb = undefined;
            }
          } else if (field) {
            const chunk = safeData(start, Math.min(end, start + fieldSizeLimit - fieldSize));
            fieldSize += chunk.byteLength;
            field.push(partDecoder.decode(chunk));
            if (fieldSize === fieldSizeLimit) {
              skipPart = true;
              partTruncated = true;
            }
          }
        }
        break;
      }
      if (isMatch) {
        matchPostBoundary = 1;
        if (this._fileStream) {
          // End the active file stream if the previous part was a file
          this._fileStream.push(null);
          this._fileStream = undefined;
        } else if (field) {
          const value = field.join('');
          field = undefined;
          fieldSize = 0;
          this.emit('field', partName, value, {
            nameTruncated,
            valueTruncated: partTruncated,
            encoding: partEncoding,
            mimeType: partType,
          });
        }
        if (++parts === partsLimit) {
          this.emit('partsLimit');
        }
      }
    });

    // Just in case there is no preamble
    this.write(BUF_CRLF);
  }

  /** @internal */
  _checkEndState() {
    if (this._hparser) {
      return new Error('Malformed part header');
    }
    const fileStream = this._fileStream;
    if (fileStream) {
      this._fileStream = undefined;
      fileStream.destroy(new Error('Unexpected end of file'));
    }
    if (!this._complete) {
      return new Error('Unexpected end of form');
    }
    return null;
  }
}

function write(
  this: Multipart,
  chunk: Buffer,
  _: BufferEncoding,
  cb: (err?: Error | null) => void,
) {
  this._writecb = cb;
  this._bparser.push(chunk);
  const cbDone = this._writecb;
  if (cbDone) {
    this._writecb = undefined;
    cbDone();
  }
}

function destroy(this: Multipart, err: Error | null, cb: (err?: Error | null) => void) {
  this._hparser = undefined;
  this._bparser = IGNORE_DATA;
  err ??= this._checkEndState();
  const fileStream = this._fileStream;
  if (fileStream) {
    this._fileStream = undefined;
    fileStream.destroy(err ?? undefined);
  }
  cb(err);
}

function final(this: Multipart, cb: (err?: Error | null) => void) {
  this._bparser.destroy();
  if (!this._complete) {
    return cb(new Error('Unexpected end of form'));
  }
  if (this._fileEndsLeft) {
    this._finalcb = () => cb(this._checkEndState());
  } else {
    cb(this._checkEndState());
  }
}

const MAX_HEADER_PAIRS = 2000; // From node
const MAX_HEADER_SIZE = 16 * 1024; // From node (its default value)

const HPARSER_NAME = 0;
const HPARSER_PRE_OWS = 1;
const HPARSER_VALUE = 2;

type Header = Record<string, Buffer[]>;

class HeaderParser {
  /** @internal */ declare private _header: Header;
  /** @internal */ declare private _pairCount: number;
  /** @internal */ declare private _byteCount: number;
  /** @internal */ declare private _state:
    | typeof HPARSER_NAME
    | typeof HPARSER_PRE_OWS
    | typeof HPARSER_VALUE;
  /** @internal */ declare private readonly _name: string[];
  /** @internal */ declare private readonly _value: Buffer[];
  /** @internal */ declare private _crlf: number;
  /** @internal */ declare private _cb: (header: Header) => void;

  constructor(cb: (header: Header) => void) {
    this._header = Object.create(null);
    this._pairCount = 0;
    this._byteCount = 0;
    this._state = HPARSER_NAME;
    this._name = [];
    this._value = [];
    this._crlf = 0;
    this._cb = cb;
  }

  reset() {
    this._header = Object.create(null);
    this._pairCount = 0;
    this._byteCount = 0;
    this._state = HPARSER_NAME;
    this._name.length = 0;
    this._value.length = 0;
    this._crlf = 0;
  }

  push(chunk: Buffer, pos: number, end: number, isDataSafe: boolean) {
    let start = pos;
    main: while (pos < end) {
      switch (this._state) {
        case HPARSER_NAME: {
          for (; pos < end; ++pos) {
            if (this._byteCount === MAX_HEADER_SIZE) {
              return -1;
            }
            ++this._byteCount;
            const code = chunk[pos]!;
            if (!TOKEN[code]) {
              if (code !== 58 /* ':' */) {
                return -1;
              }
              if (pos > start) {
                this._name.push(LATIN1.decode(chunk.subarray(start, pos)));
              }
              if (!this._name.length) {
                return -1;
              }
              ++pos;
              this._state = HPARSER_PRE_OWS;
              continue main;
            }
          }
          if (pos > start) {
            this._name.push(LATIN1.decode(chunk.subarray(start, pos)));
          }
          break;
        }
        case HPARSER_PRE_OWS: {
          // Skip optional whitespace
          for (; pos < end; ++pos) {
            if (this._byteCount === MAX_HEADER_SIZE) {
              return -1;
            }
            ++this._byteCount;
            const code = chunk[pos];
            if (code !== 32 /* ' ' */ && code !== 9 /* '\t' */) {
              start = pos;
              this._state = HPARSER_VALUE;
              continue main;
            }
          }
          break;
        }
        case HPARSER_VALUE:
          switch (this._crlf) {
            case 0: // Nothing yet
              for (; pos < end; ++pos) {
                if (this._byteCount === MAX_HEADER_SIZE) {
                  return -1;
                }
                ++this._byteCount;
                const code = chunk[pos]!;
                if (code < 32 || code === 127) {
                  if (code !== 13 /* '\r' */) {
                    return -1;
                  }
                  ++this._crlf;
                  break;
                }
              }
              if (isDataSafe) {
                this._value.push(chunk.subarray(start, pos));
              } else {
                const longLived = Buffer.allocUnsafe(pos - start);
                chunk.copy(longLived, 0, start, pos);
                this._value.push(longLived);
              }
              ++pos;
              break;
            case 1: // Received CR
              if (this._byteCount === MAX_HEADER_SIZE) {
                return -1;
              }
              ++this._byteCount;
              if (chunk[pos++] !== 10 /* '\n' */) {
                return -1;
              }
              ++this._crlf;
              break;
            case 2: {
              // Received CR LF
              if (this._byteCount === MAX_HEADER_SIZE) {
                return -1;
              }
              ++this._byteCount;
              const code = chunk[pos];
              if (code === 32 /* ' ' */ || code === 9 /* '\t' */) {
                // Folded value
                start = pos;
                this._crlf = 0;
              } else {
                if (++this._pairCount < MAX_HEADER_PAIRS) {
                  const name = this._name.join('').toLowerCase();
                  const value = Buffer.concat(this._value);
                  const existing = this._header[name];
                  if (existing) {
                    existing.push(value);
                  } else {
                    this._header[name] = [value];
                  }
                }
                if (code === 13 /* '\r' */) {
                  ++this._crlf;
                  ++pos;
                } else {
                  // Assume start of next header field name
                  start = pos;
                  this._crlf = 0;
                  this._state = HPARSER_NAME;
                  this._name.length = 0;
                  this._value.length = 0;
                }
              }
              break;
            }
            case 3: {
              // Received CR LF CR
              if (this._byteCount === MAX_HEADER_SIZE) {
                return -1;
              }
              ++this._byteCount;
              if (chunk[pos++] !== 10 /* '\n' */) {
                return -1;
              }
              // End of header
              const header = this._header;
              this.reset();
              this._cb(header);
              return pos;
            }
          }
      }
    }

    return pos;
  }
}

class FileStream extends Readable {
  /** @internal */ declare _readcb: (() => void) | undefined;
  declare truncated: boolean;

  constructor(opts: ReadableOptions, owner: Multipart) {
    super({ ...opts, read } as ReadableOptions);
    this.truncated = false;
    this.once('end', () => {
      // We need to make sure that we call any outstanding _writecb() that is
      // associated with this file so that processing of the rest of the form
      // can continue. This may not happen if the file stream ends right after
      // backpressure kicks in, so we force it here.
      read.call(this);
      if (--owner._fileEndsLeft === 0 && owner._finalcb) {
        const cb = owner._finalcb;
        owner._finalcb = undefined;
        // Make sure other 'end' event handlers get a chance to be executed
        // before busboy's 'finish' event is emitted
        process.nextTick(cb);
      }
    });
  }
}

function read(this: FileStream, _?: number) {
  const cb = this._readcb;
  if (cb) {
    this._readcb = undefined;
    cb();
  }
}

const IGNORE_DATA = { push: () => {}, destroy: () => {} };

function osIndependentBasename(path: string) {
  for (let i = path.length; i-- > 0; ) {
    if (path[i] === '/' || path[i] === '\\') {
      path = path.slice(i + 1);
      break;
    }
  }
  return path === '..' || path === '.' ? '' : path;
}

const BUF_CRLF = /*@__PURE__*/ Buffer.from('\r\n');
