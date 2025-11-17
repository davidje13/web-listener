import { Readable, Writable, type ReadableOptions, type WritableOptions } from 'node:stream';
import type { Decoder } from '../../util/DecoderStream.mts';
import { HTTPError } from '../../core/HTTPError.mts';
import { getTextDecoder } from '../../extras/registries/charset.mts';
import { StreamSearch } from '../streamsearch/sbmh.mts';
import { parseContentType, parseDisposition, TOKEN, type ContentTypeParams } from './utils.mts';
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
      throw new HTTPError(400, { body: 'multipart boundary not found' });
    }
    if (boundary.length > 70) {
      throw new HTTPError(400, { body: 'multipart boundary too long' });
    }
    const paramDecoder = getTextDecoder(defParamCharset);
    const fileOpts = { autoDestroy: true, emitClose: true, highWaterMark: fileHwm };

    const fieldSizeLimit = limits.fieldSize ?? 1 * 1024 * 1024;
    const fileSizeLimit = limits.fileSize ?? Number.POSITIVE_INFINITY;
    const fieldNameSizeLimit = limits.fieldNameSize ?? 100;
    const filesLimit = limits.files ?? Number.POSITIVE_INFINITY;
    const fieldsLimit = limits.fields ?? Number.POSITIVE_INFINITY;
    const partsLimit = limits.parts ?? Number.POSITIVE_INFINITY;

    let parts = 0;
    let fields = 0;
    let files = 0;
    let partSizeRemaining = -1;

    this._fileEndsLeft = 0;
    this._complete = false;

    let field: string | undefined;
    let partDecoder: Decoder;
    let partEncoding: string;
    let partType: string;
    let partName: string | undefined;
    let nameTruncated = false;

    const hparser = new HeaderParser((header) => {
      this._hparser = undefined;
      const disposition = header['content-disposition'];
      if (!disposition) {
        partSizeRemaining = -1;
        return;
      }
      const disp = parseDisposition(Buffer.from(disposition, 'latin1'), paramDecoder);
      if (disp?.type !== 'form-data') {
        partSizeRemaining = -1;
        return;
      }
      partName = disp.params.get('name') ?? '';
      nameTruncated = partName.length > fieldNameSizeLimit;
      if (nameTruncated) {
        partName = partName.substring(0, fieldNameSizeLimit);
      }
      let filename = disp.params.get('filename*') ?? disp.params.get('filename');
      if (filename !== undefined && !preservePath) {
        filename = osIndependentBasename(filename);
      }
      const conType = parseContentType(header['content-type']);
      partType = conType?.mime ?? 'text/plain';
      const partCharset = conType?.params.get('charset')?.toLowerCase() ?? defCharset;
      partDecoder = getTextDecoder(partCharset);
      partEncoding = header['content-transfer-encoding']?.toLowerCase() ?? '7bit';
      if (partType === 'application/octet-stream' || filename !== undefined) {
        // File
        if (files++ === filesLimit) {
          this.emit('filesLimit');
        }
        if (files > filesLimit || this.listenerCount('file') === 0) {
          partSizeRemaining = -1;
          return;
        }
        this._fileStream = new FileStream(fileOpts, this);
        ++this._fileEndsLeft;
        this.emit('file', partName, this._fileStream, {
          nameTruncated,
          filename,
          encoding: partEncoding,
          mimeType: partType,
        });
        partSizeRemaining = fileSizeLimit;
      } else {
        // Non-file
        if (fields++ === fieldsLimit) {
          this.emit('fieldsLimit');
        }
        if (fields > fieldsLimit || this.listenerCount('field') === 0) {
          partSizeRemaining = -1;
          return;
        }
        field = '';
        partSizeRemaining = fieldSizeLimit;
      }
    });

    let matchPostBoundary = 0;
    const needle = Buffer.from(`\r\n--${boundary}`, 'latin1');
    this._bparser = new StreamSearch(needle, (isMatch, data, start, end, isDataSafe) => {
      try {
        if (start === end) {
          return;
        }
        if (matchPostBoundary) {
          if (matchPostBoundary === 1) {
            if (data[start] === 13) {
              // Try matching CR LF before header
              matchPostBoundary = 2;
            } else if (data[start] === 45) {
              // Try matching '--' after boundary
              matchPostBoundary = 3;
            } else {
              matchPostBoundary = 0;
              return;
            }
            if (++start === end) {
              return;
            }
          }
          if (matchPostBoundary === 2) {
            matchPostBoundary = 0;
            if (data[start++] !== 10 /* '\n' */) {
              return; // We saw something other than LF, so this section is invalid and will be ignored
            }
            if (parts++ === partsLimit) {
              this.emit('partsLimit');
            }
            if (parts > partsLimit) {
              return;
            }
            // Prepare the header parser
            this._hparser = hparser;
            // Process the remaining data as a header
            if (start === end) {
              return;
            }
          } else {
            matchPostBoundary = 0;
            if (data[start] !== 45 /* '-' */) {
              return; // We saw something other than '-', so this section is invalid and will be ignored
            }
            // End of multipart data
            this._complete = true;
            this._bparser = IGNORE_DATA;
            return;
          }
        }
        if (this._hparser) {
          const ret = this._hparser.push(data, start, end);
          if (ret === -1) {
            this._hparser = undefined;
            hparser.reset();
            this.emit('error', new HTTPError(400, { body: 'malformed part header' }));
            return;
          }
          if (ret === end) {
            return;
          }
          start = ret;
        }
        if (partSizeRemaining >= 0) {
          const stop = Math.min(end, start + partSizeRemaining);
          partSizeRemaining -= end - start;
          if (this._fileStream) {
            if (stop > start) {
              let safeData: Buffer;
              if (isDataSafe) {
                safeData = data.subarray(start, stop);
              } else {
                safeData = Buffer.allocUnsafe(stop - start);
                data.copy(safeData, 0, start, stop);
              }
              if (!this._fileStream.push(safeData)) {
                this._fileStream._readcb ??= this._writecb;
                this._writecb = undefined;
              }
            }
            if (partSizeRemaining < 0) {
              this._fileStream.emit('limit');
              this._fileStream.truncated = true;
            }
          } else if (field !== undefined) {
            field += data.latin1Slice(start, stop);
          }
        }
      } finally {
        if (isMatch) {
          if (this._hparser) {
            this.emit('error', new HTTPError(400, { body: 'unexpected end of headers' }));
            this._hparser = undefined;
          } else if (this._fileStream) {
            // End the active file stream if the previous part was a file
            this._fileStream.push(null);
            this._fileStream = undefined;
          } else if (field !== undefined) {
            this.emit('field', partName, partDecoder.decode(Buffer.from(field, 'latin1')), {
              nameTruncated,
              valueTruncated: partSizeRemaining < 0,
              encoding: partEncoding,
              mimeType: partType,
            });
            field = undefined;
          }
          matchPostBoundary = 1;
          partSizeRemaining = -1;
        }
      }
    });

    // Just in case there is no preamble
    this.write(BUF_CRLF);
  }

  /** @internal */
  _checkEndState() {
    if (this._hparser) {
      return new HTTPError(400, { body: 'malformed part header' });
    }
    const fileStream = this._fileStream;
    if (fileStream) {
      this._fileStream = undefined;
      fileStream.destroy(new HTTPError(400, { body: 'unexpected end of file' }));
    }
    if (!this._complete) {
      return new HTTPError(400, { body: 'unexpected end of form' });
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
    return cb(new HTTPError(400, { body: 'unexpected end of form' }));
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

type Header = Record<string, string>;

class HeaderParser {
  /** @internal */ declare private _header: Header;
  /** @internal */ declare private _pairCount: number;
  /** @internal */ declare private _byteCount: number;
  /** @internal */ declare private _state:
    | typeof HPARSER_NAME
    | typeof HPARSER_PRE_OWS
    | typeof HPARSER_VALUE;
  /** @internal */ declare private _name: string;
  /** @internal */ declare private _value: string;
  /** @internal */ declare private _crlf: number;
  /** @internal */ declare private _cb: (header: Header) => void;

  constructor(cb: (header: Header) => void) {
    this._header = Object.create(null);
    this._pairCount = 0;
    this._byteCount = 0;
    this._state = HPARSER_NAME;
    this._name = '';
    this._value = '';
    this._crlf = 0;
    this._cb = cb;
  }

  reset() {
    this._header = Object.create(null);
    this._pairCount = 0;
    this._byteCount = 0;
    this._state = HPARSER_NAME;
    this._name = '';
    this._value = '';
    this._crlf = 0;
  }

  push(chunk: Buffer, p0: number, p1: number) {
    let start = p0;
    let pos = p0;
    const end = Math.min(p1, p0 + MAX_HEADER_SIZE - this._byteCount);
    while (pos < end) {
      switch (this._state) {
        case HPARSER_NAME: {
          for (; pos < end && TOKEN[chunk[pos]!]; ++pos);
          if (pos > start) {
            this._name += chunk.latin1Slice(start, pos);
          }
          if (pos < end) {
            if (chunk[pos] !== 58 /* ':' */) {
              return -1;
            }
            if (!this._name) {
              return -1;
            }
            ++pos;
            this._state = HPARSER_PRE_OWS;
          }
          break;
        }
        case HPARSER_PRE_OWS: {
          // Skip optional whitespace
          for (; pos < end; ++pos) {
            const code = chunk[pos];
            if (code !== 32 /* ' ' */ && code !== 9 /* '\t' */) {
              start = pos;
              this._state = HPARSER_VALUE;
              break;
            }
          }
          break;
        }
        case HPARSER_VALUE:
          switch (this._crlf) {
            case 0: // Nothing yet
              for (; pos < end; ++pos) {
                const code = chunk[pos]!;
                if (code < 32 || code === 127) {
                  if (code !== 13 /* '\r' */) {
                    return -1;
                  }
                  ++this._crlf;
                  break;
                }
              }
              this._value += chunk.latin1Slice(start, pos);
              ++pos;
              break;
            case 1: // Received CR
              if (chunk[pos++] !== 10 /* '\n' */) {
                return -1;
              }
              ++this._crlf;
              break;
            case 2: {
              // Received CR LF
              const code = chunk[pos];
              if (code === 32 /* ' ' */ || code === 9 /* '\t' */) {
                // Folded value
                start = pos;
                this._crlf = 0;
              } else {
                if (++this._pairCount < MAX_HEADER_PAIRS) {
                  this._header[this._name.toLowerCase()] ??= this._value;
                }
                if (code === 13 /* '\r' */) {
                  ++this._crlf;
                  ++pos;
                } else {
                  // Assume start of next header field name
                  start = pos;
                  this._crlf = 0;
                  this._state = HPARSER_NAME;
                  this._name = '';
                  this._value = '';
                }
              }
              break;
            }
            case 3: {
              // Received CR LF CR
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
    if (end < p1) {
      return -1;
    }
    this._byteCount += end - p0;
    return end;
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
