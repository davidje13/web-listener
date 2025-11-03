import { ServerResponse } from 'node:http';
import type { Writable } from 'node:stream';
import { internalDrainUncorked } from '../../util/drain.mts';
import { VOID_BUFFER } from '../../util/voidBuffer.mts';

export interface CSVOptions {
  /**
   * The delimiter to use between cells
   * @default ','
   */
  delimiter?: string | Uint8Array;

  /**
   * The delimiter to use between rows
   * @default '\n'
   */
  newline?: string | Uint8Array;

  /**
   * The quote character to use. Typically should be `"` or (if the target application supports it) `'`
   * @default '"'
   */
  quote?: string;

  /**
   * The text encoding to use.
   * @default 'utf-8'
   */
  encoding?: BufferEncoding;

  /**
   * For use with `ServerResponse` targets.
   * If `true`, adds header=present to the mime type; if `false`, adds header=absent to the mime type.
   * @default undefined
   */
  headerRow?: boolean | undefined;

  /**
   * If `true`, will call `end()` on target stream after writing.
   * @default true
   */
  end?: boolean;
}

type MaybeAsyncIterable<T> = Iterable<T> | AsyncIterable<T>;

/**
 * Output a CSV formatted table, using the format from RFC4180.
 * Specifically:
 * - lines are separated by newlines;
 * - cells are separated by commas;
 * - cells containing whitespace, commas, newlines, etc. are quoted with double quotes;
 * - double quotes appearing inside cell values are escaped by doubling: `"a""b"`.
 *
 * The line and cell delimiters can be configured (e.g. `{ delimiter: '\t', newline: '\r\n' }`)
 */
export async function sendCSVStream(
  target: Writable,
  table: MaybeAsyncIterable<MaybeAsyncIterable<string | null | undefined>>,
  {
    delimiter = ',',
    newline = '\n',
    quote = '"',
    encoding = 'utf-8',
    headerRow,
    end = true,
  }: CSVOptions = {},
) {
  if (typeof delimiter === 'string') {
    delimiter = Buffer.from(delimiter, encoding);
  }
  if (typeof newline === 'string') {
    newline = Buffer.from(newline, encoding);
  }
  const encQuote = typeof quote === 'string' ? Buffer.from(quote, encoding) : quote;
  const escapedQuote = quote + quote;
  const writeCell = (content: string | null | undefined) => {
    if (!content) {
      return true;
    }

    const hasQuote = content.includes(quote);
    if (!hasQuote && SIMPLE_CSV_CELL.test(content)) {
      return target.write(content, encoding);
    }
    target.write(encQuote);
    if (hasQuote) {
      target.write(content.replaceAll(quote, escapedQuote), encoding);
    } else {
      target.write(content, encoding);
    }
    return target.write(encQuote);
  };

  if (
    target instanceof ServerResponse &&
    !target.headersSent &&
    !target.hasHeader('content-type')
  ) {
    target.setHeader(
      'content-type',
      'text/csv; charset=' +
        encoding +
        (headerRow ? '; header=present' : headerRow === false ? '; header=absent' : ''),
    );
  }

  target.cork();
  try {
    // flush headers before we try streaming the content
    // (else the first value will be in its own chunk, despite using cork())
    target.write(VOID_BUFFER);

    for await (const row of table) {
      if (target.writableAborted) {
        break;
      }
      let col = 0;
      if (Symbol.iterator in row) {
        for (const cell of row) {
          if (col) {
            target.write(delimiter);
          }
          if (!writeCell(cell)) {
            await internalDrainUncorked(target);
          }
          ++col;
        }
      } else {
        for await (const cell of row) {
          if (col) {
            target.write(delimiter);
          }
          if (!writeCell(cell)) {
            await internalDrainUncorked(target);
          }
          ++col;
        }
      }
      if (!target.write(newline)) {
        await internalDrainUncorked(target);
      }
    }
  } finally {
    target.uncork();
  }
  if (end) {
    target.end();
  }
}

const SIMPLE_CSV_CELL = /^[^"':;,\\\r\n\t ]*$/i;
