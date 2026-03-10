import { ServerResponse } from 'node:http';
import type { Readable, Writable } from 'node:stream';
import { ReadableStream } from 'node:stream/web';
import { internalDrainUncorked } from '../../util/drain.mts';
import { VOID_BUFFER } from '../../util/voidBuffer.mts';
import { dispose, LoadOnDemand } from './LoadOnDemand.mts';

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
type MaybeLoadOnDemand<T> = LoadOnDemand<T> | T;

type CellContent = string | ReadableStream<string> | Readable | null | undefined;

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
  table: MaybeLoadOnDemand<
    MaybeAsyncIterable<MaybeLoadOnDemand<MaybeAsyncIterable<MaybeLoadOnDemand<CellContent>>>>
  >,
  {
    delimiter = ',',
    newline = '\n',
    quote = '"',
    encoding = 'utf-8',
    headerRow,
    end = true,
  }: CSVOptions = {},
) {
  if (!target.writable) {
    return;
  }
  if (typeof delimiter === 'string') {
    delimiter = Buffer.from(delimiter, encoding);
  }
  if (typeof newline === 'string') {
    newline = Buffer.from(newline, encoding);
  }
  const encQuote = typeof quote === 'string' ? Buffer.from(quote, encoding) : quote;
  const escapedQuote = quote + quote;
  const writeCell = (content: CellContent): Promise<void> | true => {
    if (!content || !target.writable) {
      return true;
    }

    if (typeof content === 'string') {
      const hasQuote = content.includes(quote);
      if (!hasQuote && SIMPLE_CSV_CELL.test(content)) {
        return target.write(content, encoding) || internalDrainUncorked(target);
      }
      target.write(encQuote);
      if (hasQuote) {
        target.write(content.replaceAll(quote, escapedQuote), encoding);
      } else {
        target.write(content, encoding);
      }
      return target.write(encQuote) || internalDrainUncorked(target);
    }

    return (async () => {
      target.write(encQuote);
      for await (const chunk of content) {
        if (typeof chunk !== 'string') {
          throw new TypeError('Readables must have an encoding');
        }
        if (!target.writable) {
          break;
        }
        if (!target.write(chunk.replaceAll(quote, escapedQuote), encoding)) {
          await internalDrainUncorked(target);
        }
      }
      target.write(encQuote);
    })();
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
  if (table instanceof LoadOnDemand) {
    table = await table.load();
  }
  try {
    // flush headers before we try streaming the content
    // (else the first value will be in its own chunk, despite using cork())
    target.write(VOID_BUFFER);

    for await (let row of table) {
      if (!target.writable) {
        break;
      }
      if (row instanceof LoadOnDemand) {
        row = await row.load();
      }
      try {
        let col = 0;
        if (Symbol.iterator in row) {
          for (let cell of row) {
            if (!target.writable) {
              break;
            }
            if (col) {
              target.write(delimiter);
            }
            if (cell instanceof LoadOnDemand) {
              cell = await cell.load();
            }
            try {
              const p = writeCell(cell);
              if (p) {
                await p;
              }
            } finally {
              const p = dispose(cell);
              if (p) {
                await p;
              }
            }
            ++col;
          }
        } else {
          for await (let cell of row) {
            if (!target.writable) {
              break;
            }
            if (col) {
              target.write(delimiter);
            }
            if (cell instanceof LoadOnDemand) {
              cell = await cell.load();
            }
            try {
              const p = writeCell(cell);
              if (p) {
                await p;
              }
            } finally {
              const p = dispose(cell);
              if (p) {
                await p;
              }
            }
            ++col;
          }
        }
      } finally {
        const p = dispose(row);
        if (p) {
          await p;
        }
      }
      if (!target.write(newline)) {
        await internalDrainUncorked(target);
      }
    }
  } finally {
    target.uncork();
    const p = dispose(table);
    if (p) {
      await p;
    }
  }
  if (end) {
    target.end();
  }
}

const SIMPLE_CSV_CELL = /^[^"':;,\\\r\n\t ]*$/i;
