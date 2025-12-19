import { Readable, type ReadableOptions } from 'node:stream';
import type { Decoder } from '../../util/DecoderStream.mts';
import { HTTPError } from '../../core/HTTPError.mts';
import { getTextDecoder } from '../../extras/registries/charset.mts';
import { StreamSearch } from '../streamsearch/sbmh.mts';
import { parseContentType, parseDisposition, TOKEN, type ContentTypeParams } from './utils.mts';
import type { BusboyOptions, StreamConsumer } from './types.mts';

const STATE_POST_BOUNDARY = 0;
const STATE_POST_BOUNDARY_CR = 1;
const STATE_POST_BOUNDARY_DASH = 2;
const STATE_HEADER = 3;
const STATE_CONTENT = 4;
const STATE_SKIP = 5;
const STATE_COMPLETE = 6;
const STATE_ERROR = 7;

export function getMultipartFormFields(
  {
    preservePath,
    fileHwm,
    defParamCharset = 'utf-8',
    defCharset = 'utf-8',
    maxNetworkBytes = Number.POSITIVE_INFINITY,
    maxContentBytes = maxNetworkBytes,
    maxFieldSize = 1 * 1024 * 1024,
    maxFileSize = Number.POSITIVE_INFINITY,
    maxTotalFileSize = Number.POSITIVE_INFINITY,
    maxFieldNameSize = 100,
    maxParts = Number.POSITIVE_INFINITY,
    maxFields = Number.POSITIVE_INFINITY,
    maxFiles = Number.POSITIVE_INFINITY,
  }: BusboyOptions,
  conTypeParams: ContentTypeParams,
): StreamConsumer {
  const boundary = conTypeParams.get('boundary');
  if (!boundary) {
    throw new HTTPError(400, { body: 'multipart boundary not found' });
  }
  if (boundary.length > 70) {
    throw new HTTPError(400, { body: 'multipart boundary too long' });
  }
  const paramDecoder = getTextDecoder(defParamCharset);
  const fileOpts: ReadableOptions = {
    autoDestroy: true,
    emitClose: true,
    highWaterMark: fileHwm,
    read: internalFileStreamRead,
  };

  return (source, callback) =>
    new Promise((resolve, reject) => {
      let state = STATE_SKIP;

      let networkRemaining = maxNetworkBytes;
      let contentRemaining = maxContentBytes;
      let totalFileSizeRemaining = maxTotalFileSize;
      let partsRemaining = maxParts;
      let fieldsRemaining = maxFields;
      let filesRemaining = maxFiles;
      let partSizeRemaining = 0;

      let awaitingFileDrain = false;
      let activeFileStreams = 0;
      let fileStream: FileStream | undefined;
      let finalcb: (() => void) | undefined;

      let partName: string | undefined;
      let filename: string | undefined;
      let mimeType: string;
      let partEncoding: string;
      let partDecoder: Decoder;
      let partContent = '';

      const hparser = new HeaderParser((header) => {
        const disposition = header[CONTENT_DISPOSITION];
        if (!disposition) {
          state = STATE_SKIP;
          return;
        }
        const disp = parseDisposition(Buffer.from(disposition, 'latin1'), paramDecoder);
        if (disp?.type !== 'form-data') {
          state = STATE_SKIP;
          return;
        }
        partName = disp.params.get('name');
        if (partName === undefined) {
          return handleError(new HTTPError(400, { body: 'missing field name' }));
        }
        const nameLength = Buffer.byteLength(partName, 'utf-8');
        const nameLimit = Math.min(maxFieldNameSize, contentRemaining);
        if (nameLength > nameLimit) {
          return handleError(
            new HTTPError(413, {
              body: `field name ${JSON.stringify(partName.substring(0, nameLimit))}... too long`,
            }),
          );
        }
        contentRemaining -= nameLength;
        filename = disp.params.get('filename*') ?? disp.params.get('filename');
        const contentType = parseContentType(header[CONTENT_TYPE]);
        mimeType = contentType?.mime ?? 'text/plain';
        partEncoding = header[CONTENT_TRANSFER_ENCODING]?.toLowerCase() ?? '7bit';
        if (mimeType === 'application/octet-stream' || filename !== undefined) {
          // File
          if (!filesRemaining--) {
            return handleError(new HTTPError(413, { body: 'too many files' }));
          }
          if (!filename) {
            // if a file field is submitted without any files, it will send an empty entry: ignore it
            state = STATE_SKIP;
            return;
          }
          if (!preservePath) {
            filename = osIndependentBasename(filename);
          }
          const fs: FileStream = new Readable(fileOpts);
          fs.once('error', NOOP); // do not explode if error is not captured by user - it is reported on the main stream anyway
          fs.once('close', () => {
            fs._readcb?.();
            fs.off('error', NOOP);
            if (!--activeFileStreams && finalcb) {
              // Make sure other 'end' event handlers get a chance to be executed
              // before busboy resolves
              process.nextTick(finalcb);
            }
          });
          fileStream = fs;
          ++activeFileStreams;
          partSizeRemaining = Math.min(
            maxFileSize,
            totalFileSizeRemaining,
            contentRemaining,
            networkRemaining,
          );
          callback({
            name: partName,
            type: 'file',
            value: fs,
            filename,
            encoding: partEncoding,
            mimeType,
            sizeLimit: partSizeRemaining,
          });
          state = STATE_CONTENT;
        } else {
          // Non-file
          if (!fieldsRemaining--) {
            return handleError(new HTTPError(413, { body: 'too many fields' }));
          }
          state = STATE_CONTENT;
          partSizeRemaining = Math.min(maxFieldSize, contentRemaining, networkRemaining);
          const partCharset = contentType?.params.get('charset')?.toLowerCase() ?? defCharset;
          partDecoder = getTextDecoder(partCharset);
        }
      });

      const needle = Buffer.from(`\r\n--${boundary}`, 'latin1');
      const chunkSplitter = new StreamSearch(
        needle,
        (data, start, end, isDataSafe) => {
          if (state <= STATE_POST_BOUNDARY_DASH) {
            if (state === STATE_POST_BOUNDARY) {
              if (data[start] === 13) {
                state = STATE_POST_BOUNDARY_CR; // Try matching CR LF before header
              } else if (data[start] === 45) {
                state = STATE_POST_BOUNDARY_DASH; // Try matching '--' after boundary
              } else {
                state = STATE_SKIP; // invalid section (skip)
                return;
              }
              if (++start === end) {
                return;
              }
            }
            if (state === STATE_POST_BOUNDARY_CR) {
              if (data[start++] !== 10 /* '\n' */) {
                state = STATE_SKIP; // invalid section (skip)
                return;
              }
              if (!partsRemaining--) {
                return handleError(new HTTPError(413, { body: 'too many parts' }));
              }
              state = STATE_HEADER;
              if (start === end) {
                return;
              }
            } else {
              if (data[start] !== 45 /* '-' */) {
                state = STATE_SKIP; // invalid section (skip)
                return;
              }
              // End of multipart data
              state = STATE_COMPLETE;
              source.off('data', handleData);
              source.resume();
              return;
            }
          }
          if (state === STATE_HEADER) {
            start = hparser.push(data, start, end);
            if (start === -1) {
              return handleError(new HTTPError(400, { body: 'malformed part header' }));
            }
            if (start === end) {
              return;
            }
          }
          if (state === STATE_CONTENT) {
            const stop = Math.min(end, start + partSizeRemaining);
            partSizeRemaining -= end - start;
            contentRemaining -= end - start;
            if (fileStream) {
              totalFileSizeRemaining -= end - start;
              if (stop > start) {
                let safeData: Buffer;
                if (isDataSafe) {
                  safeData = data.subarray(start, stop);
                } else {
                  safeData = Buffer.allocUnsafe(stop - start);
                  data.copy(safeData, 0, start, stop);
                }
                if (!fileStream.push(safeData)) {
                  awaitingFileDrain = true;
                }
              }
              if (partSizeRemaining < 0) {
                return handleError(
                  new HTTPError(413, {
                    body: `uploaded file for ${JSON.stringify(partName)}: ${JSON.stringify(filename)} too large`,
                  }),
                );
              }
            } else {
              if (partSizeRemaining < 0) {
                return handleError(
                  new HTTPError(413, { body: `value for ${JSON.stringify(partName)} too long` }),
                );
              }
              partContent += data.latin1Slice(start, stop);
            }
          }
        },
        () => {
          if (state === STATE_HEADER) {
            return handleError(new HTTPError(400, { body: 'unexpected end of headers' }));
          }
          if (state === STATE_CONTENT) {
            if (fileStream) {
              // End the active file stream if the previous part was a file
              fileStream.push(null);
              fileStream = undefined;
              awaitingFileDrain = false;
            } else {
              const contentBuffer = Buffer.from(partContent, 'latin1');
              partContent = '';
              callback({
                name: partName!,
                type: 'string',
                value: partDecoder.decode(contentBuffer),
                encoding: partEncoding,
                mimeType,
              });
            }
          }
          if (state < STATE_COMPLETE) {
            state = STATE_POST_BOUNDARY;
          }
        },
      );

      chunkSplitter.push(BUF_CRLF); // allow matching boundary immediately at start of content

      const handleData = (chunk: Buffer) => {
        if ((networkRemaining -= chunk.byteLength) < 0) {
          return handleError(new HTTPError(413, { body: 'content too large' }));
        }
        awaitingFileDrain = false;
        chunkSplitter.push(chunk);
        if (fileStream && awaitingFileDrain) {
          source.pause();
          fileStream._readcb = () => source.resume();
        }
      };

      const handleEnd = () => {
        if (state === STATE_ERROR) {
          return;
        }
        if (state !== STATE_COMPLETE) {
          chunkSplitter.destroy();
          if (state !== STATE_COMPLETE) {
            return handleError(new HTTPError(400, { body: 'unexpected end of form' }));
          }
        }
        source.off('data', handleData);
        source.off('end', handleEnd);
        finalcb = () => {
          source.off('error', handleError);
          resolve();
        };
        if (!activeFileStreams) {
          finalcb();
        }
      };

      const handleError = (err: Error) => {
        if (state === STATE_ERROR) {
          return;
        }
        state = STATE_ERROR;
        source.off('data', handleData);
        source.off('end', handleEnd);
        source.off('error', handleError);
        fileStream?.destroy(err);
        fileStream = undefined;
        reject(err);
      };

      source.on('data', handleData);
      source.once('end', handleEnd);
      source.once('error', handleError);
    });
}

const MAX_HEADER_SIZE = 16 * 1024; // From node (its default value)

const HPARSER_NAME = 0;
const HPARSER_PRE_OWS = 1;
const HPARSER_VALUE = 2;
const HPARSER_VALUE_CR = 3;
const HPARSER_VALUE_CRLF = 4;
const HPARSER_VALUE_CRLFCR = 5;

type Headers = (string | undefined)[];

class HeaderParser {
  /** @internal */ declare private _headers: Headers;
  /** @internal */ declare private _bytesRemaining: number;
  /** @internal */ declare private _state: number;
  /** @internal */ declare private _current: string;
  /** @internal */ declare private _activeHeader: HeaderInfo | undefined;
  /** @internal */ declare private _cb: (headers: Headers) => void;

  constructor(cb: (headers: Headers) => void) {
    this._cb = cb;
    this.reset();
  }

  reset() {
    this._headers = [];
    this._bytesRemaining = MAX_HEADER_SIZE;
    this._state = HPARSER_NAME;
    this._current = '';
    this._activeHeader = undefined;
  }

  push(chunk: Buffer, p0: number, p1: number) {
    let start = p0;
    let pos = p0;
    const end = Math.min(p1, p0 + this._bytesRemaining);
    while (pos < end) {
      switch (this._state) {
        case HPARSER_NAME: {
          for (; pos < end && TOKEN[chunk[pos]!]; ++pos);
          if (pos > start) {
            this._current += chunk.latin1Slice(start, pos);
          }
          if (pos < end) {
            if (chunk[pos] !== 58 /* ':' */) {
              return -1;
            }
            if (!this._current) {
              return -1;
            }
            ++pos;
            this._activeHeader = PART_HEADERS.get(this._current.toLowerCase());
            this._current = '';
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
          for (; pos < end; ++pos) {
            const code = chunk[pos]!;
            if (code < 32 || code === 127) {
              if (code !== 13 /* '\r' */) {
                return -1;
              }
              this._state = HPARSER_VALUE_CR;
              break;
            }
          }
          if (this._activeHeader) {
            this._current += chunk.latin1Slice(start, pos);
          }
          ++pos;
          break;
        case HPARSER_VALUE_CR:
          if (chunk[pos++] !== 10 /* '\n' */) {
            return -1;
          }
          this._state = HPARSER_VALUE_CRLF;
          break;
        case HPARSER_VALUE_CRLF: {
          const code = chunk[pos];
          if (code === 32 /* ' ' */ || code === 9 /* '\t' */) {
            // Folded value
            start = pos;
            this._state = HPARSER_VALUE;
          } else {
            if (this._activeHeader) {
              const id = this._activeHeader._id;
              if (this._headers[id] === undefined) {
                this._headers[id] = this._current;
              } else if (this._activeHeader._multi) {
                this._headers[id] += ',' + this._current;
              }
            }
            if (code === 13 /* '\r' */) {
              this._state = HPARSER_VALUE_CRLFCR;
              ++pos;
            } else {
              // Assume start of next header field name
              start = pos;
              this._state = HPARSER_NAME;
              this._current = '';
              this._activeHeader = undefined;
            }
          }
          break;
        }
        case HPARSER_VALUE_CRLFCR: {
          if (chunk[pos++] !== 10 /* '\n' */) {
            return -1;
          }
          // End of header
          const headers = this._headers;
          this.reset();
          this._cb(headers);
          return pos;
        }
      }
    }
    if (end < p1) {
      return -1; // exceeded maximum headers size
    }
    this._bytesRemaining -= end - p0;
    return end;
  }
}

interface HeaderInfo {
  _id: number;
  _multi: boolean;
}

const CONTENT_TYPE = 0;
const CONTENT_DISPOSITION = 1;
const CONTENT_TRANSFER_ENCODING = 2;

const PART_HEADERS = new Map<string, HeaderInfo>([
  ['content-type', { _id: CONTENT_TYPE, _multi: false }],
  ['content-disposition', { _id: CONTENT_DISPOSITION, _multi: false }],
  ['content-transfer-encoding', { _id: CONTENT_TRANSFER_ENCODING, _multi: true }],
]);

type FileStream = Readable & { _readcb?: (() => void) | undefined };

function internalFileStreamRead(this: FileStream, _?: number) {
  const cb = this._readcb;
  if (cb) {
    this._readcb = undefined;
    cb();
  }
}

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
const NOOP = () => {};
