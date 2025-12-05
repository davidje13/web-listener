import type { IncomingMessage, IncomingHttpHeaders } from 'node:http';
import {
  getAuthorization,
  getCharset,
  getIfRange,
  getRange,
  readHTTPDateSeconds,
  readHTTPInteger,
  readHTTPKeyValues,
  readHTTPQualityValues,
  readHTTPUnquotedCommaSeparated,
} from './headers.mts';
import 'lean-test';

describe('getAuthorization', () => {
  it('returns the authorization header, split at the first space', () => {
    const auth = getAuthorization({
      headers: { authorization: 'Bearer foo BAR' },
    } as IncomingMessage);
    expect(auth).equals(['bearer', 'foo BAR']);
  });

  it('ignores extra whitespace', () => {
    const auth = getAuthorization({
      headers: { authorization: 'Bearer   foo   ' },
    } as IncomingMessage);
    expect(auth).equals(['bearer', 'foo']);
  });

  it('returns undefined if the value is invalid', () => {
    const auth = getAuthorization({
      headers: { authorization: 'Bearer' },
    } as IncomingMessage);
    expect(auth).isUndefined();
  });

  it('returns undefined if the value is missing', () => {
    const auth = getAuthorization({ headers: {} } as IncomingMessage);
    expect(auth).isUndefined();
  });
});

describe('getCharset', () => {
  it('returns the charset from the content-type header', () => {
    const charset = getCharset({
      headers: { 'content-type': 'text/plain; charset=foobar' },
    } as IncomingMessage);
    expect(charset).equals('foobar');
  });

  it('returns undefined if the value is missing', () => {
    const charset = getCharset({
      headers: { 'content-type': 'text/plain' },
    } as IncomingMessage);
    expect(charset).isUndefined();
  });

  it('returns undefined if the header is missing', () => {
    const charset = getCharset({ headers: {} } as IncomingMessage);
    expect(charset).isUndefined();
  });

  it('returns undefined if the content type is not text/*', () => {
    const charset = getCharset({
      headers: { 'content-type': 'application/foo; charset=foobar' },
    } as IncomingMessage);
    expect(charset).isUndefined();
  });
});

describe('getIfRange', () => {
  it('returns if the header is set to a weak etag', () => {
    const condition = getIfRange({
      headers: { 'if-range': 'W/"foo"' } as IncomingHttpHeaders,
    } as IncomingMessage);
    expect(condition).equals({ etag: ['W/"foo"'] });
  });

  it('returns if the header is set to a strong etag', () => {
    const condition = getIfRange({
      headers: { 'if-range': '"foo"' } as IncomingHttpHeaders,
    } as IncomingMessage);
    expect(condition).equals({ etag: ['"foo"'] });
  });

  it('returns if the header is set to a modified time', () => {
    const condition = getIfRange({
      headers: { 'if-range': 'Wed, 02 Oct 2002 13:00:00 GMT' } as IncomingHttpHeaders,
    } as IncomingMessage);
    expect(condition).equals({ modifiedSeconds: 1033563600 });
  });

  it('returns an empty object if the header is missing', () => {
    const condition = getIfRange({ headers: {} } as IncomingMessage);
    expect(condition).equals({});
  });
});

describe('getRange', () => {
  it('reads the range header', () => {
    expect(getRange({ headers: { range: 'bytes=100-199' } } as IncomingMessage, 1000)).equals({
      ranges: [{ start: 100, end: 199 }],
      totalSize: 1000,
    });

    expect(
      getRange({ headers: { range: 'bytes=100-199,300-399' } } as IncomingMessage, 1000),
    ).equals({
      ranges: [
        { start: 100, end: 199 },
        { start: 300, end: 399 },
      ],
      totalSize: 1000,
    });
  });

  it('clamps ranges to the size of the content', () => {
    expect(
      getRange({ headers: { range: 'bytes=100-199,2000-2999' } } as IncomingMessage, 1000),
    ).equals({
      ranges: [{ start: 100, end: 199 }],
      totalSize: 1000,
    });

    expect(getRange({ headers: { range: 'bytes=100-2999' } } as IncomingMessage, 1000)).equals({
      ranges: [{ start: 100, end: 999 }],
      totalSize: 1000,
    });
  });

  it('throws HTTP 416 if all requested ranges are invalid', () => {
    let capturedError: unknown;
    try {
      getRange({ headers: { range: 'bytes=2000-2999' } } as IncomingMessage, 1000);
    } catch (error: unknown) {
      capturedError = error;
    }
    expect(String(capturedError)).contains('HTTPError(416 Range Not Satisfiable)');
  });

  it('interprets unbounded ranges as to-end', () => {
    expect(getRange({ headers: { range: 'bytes=100-' } } as IncomingMessage, 1000)).equals({
      ranges: [{ start: 100, end: 999 }],
      totalSize: 1000,
    });
  });

  it('interprets negative values as relative to the end', () => {
    expect(getRange({ headers: { range: 'bytes=-100' } } as IncomingMessage, 1000)).equals({
      ranges: [{ start: 900, end: 999 }],
      totalSize: 1000,
    });
  });

  it('returns undefined if the header is not present', () => {
    expect(getRange({ headers: {} } as IncomingMessage, 10)).isUndefined();
  });

  it('returns undefined if the header is not a byte range', () => {
    expect(getRange({ headers: { range: 'items=5-10' } } as IncomingMessage, 10)).isUndefined();
  });

  it('returns undefined if the ranges are empty', () => {
    expect(getRange({ headers: { range: 'bytes=' } } as IncomingMessage, 10)).isUndefined();
  });

  it('throws if the header is invalid', () => {
    expect(() => getRange({ headers: { range: 'bytes=nope' } } as IncomingMessage, 10)).throws();
    expect(() => getRange({ headers: { range: 'bytes=0-nope' } } as IncomingMessage, 10)).throws();
    expect(() => getRange({ headers: { range: 'bytes=1.5-2' } } as IncomingMessage, 10)).throws();
    expect(() => getRange({ headers: { range: 'bytes=1-2.0' } } as IncomingMessage, 10)).throws();
    expect(() => getRange({ headers: { range: 'bytes=1--1' } } as IncomingMessage, 10)).throws();
    expect(() => getRange({ headers: { range: 'bytes=nope-0' } } as IncomingMessage, 10)).throws();
    expect(() => getRange({ headers: { range: 'bytes=-' } } as IncomingMessage, 10)).throws();
  });

  it('rejects too many ranges', () => {
    expect(() =>
      getRange({ headers: { range: 'bytes=1-1,3-3,5-5,7-7,9-9' } } as IncomingMessage, 10, {
        maxRanges: 4,
      }),
    ).throws();
  });

  it('rejects too many overlapping ranges', () => {
    expect(() =>
      getRange({ headers: { range: 'bytes=1-3,2-4,3-5' } } as IncomingMessage, 10, {
        maxWithOverlap: 2,
      }),
    ).throws();

    expect(() =>
      getRange({ headers: { range: 'bytes=1-3,4-6,7-9' } } as IncomingMessage, 10, {
        maxWithOverlap: 2,
      }),
    ).not(throws());
  });

  it('rejects too many non-sequential ranges', () => {
    expect(() =>
      getRange({ headers: { range: 'bytes=7-9,4-6,1-3' } } as IncomingMessage, 10, {
        maxNonSequential: 2,
      }),
    ).throws();

    expect(() =>
      getRange({ headers: { range: 'bytes=1-3,4-6,7-9' } } as IncomingMessage, 10, {
        maxNonSequential: 2,
      }),
    ).not(throws());
  });
});

describe('readHTTPUnquotedCommaSeparated', () => {
  it('reads comma separated values', () => {
    expect(readHTTPUnquotedCommaSeparated('foo,bar,baz')).equals(['foo', 'bar', 'baz']);
  });

  it('ignores quotes', () => {
    expect(readHTTPUnquotedCommaSeparated('"foo,bar",baz')).equals(['"foo', 'bar"', 'baz']);
  });

  it('supports all possible header representations', () => {
    expect(readHTTPUnquotedCommaSeparated(['foo', 'bar,baz'])).equals(['foo', 'bar', 'baz']);
    expect(readHTTPUnquotedCommaSeparated(1)).equals(['1']);
    expect(readHTTPUnquotedCommaSeparated(0)).equals(['0']);
    expect(readHTTPUnquotedCommaSeparated(undefined)).equals(undefined);
  });

  it('interprets an empty value as an empty list', () => {
    expect(readHTTPUnquotedCommaSeparated('')).equals([]);
  });

  it('trims values', () => {
    expect(readHTTPUnquotedCommaSeparated('foo, bar , baz')).equals(['foo', 'bar', 'baz']);
    expect(readHTTPUnquotedCommaSeparated(['foo', 'bar , baz'])).equals(['foo', 'bar', 'baz']);
  });
});

describe('readHTTPInteger', () => {
  it('reads integer values', () => {
    expect(readHTTPInteger('1234')).equals(1234);
    expect(readHTTPInteger('-10')).equals(-10);
    expect(readHTTPInteger(' -12 ')).equals(-12);
    expect(readHTTPInteger('00000')).equals(0);
  });

  it('returns undefined for invalid or missing values', () => {
    expect(readHTTPInteger('abc')).isUndefined();
    expect(readHTTPInteger('10.2')).isUndefined();
    expect(readHTTPInteger('')).isUndefined();
    expect(readHTTPInteger(undefined)).isUndefined();
  });
});

describe('readHTTPQualityValues', () => {
  it('reads a dictionary of values', () => {
    const values = readHTTPQualityValues('foo;q=0.5,bar;q=0.1');
    expect(values).hasLength(2);
    expect(values![0]!.name).equals('foo');
    expect(values![0]!.q).equals(0.5);
    expect(values![1]!.name).equals('bar');
    expect(values![1]!.q).equals(0.1);
  });

  it('ignores whitespace', () => {
    const values = readHTTPQualityValues(' foo ; q = 0.5, bar; q=0.1');
    expect(values).hasLength(2);
    expect(values![0]!.name).equals('foo');
    expect(values![0]!.q).equals(0.5);
    expect(values![1]!.name).equals('bar');
    expect(values![1]!.q).equals(0.1);
  });

  it('uses a default quality of 1', () => {
    const values = readHTTPQualityValues('foo,bar;q=0');
    expect(values).hasLength(2);
    expect(values![0]!.name).equals('foo');
    expect(values![0]!.q).equals(1);
    expect(values![1]!.name).equals('bar');
    expect(values![1]!.q).equals(0);
  });

  it('clamps quality between 0 and 1', () => {
    const values = readHTTPQualityValues('foo;q=-1,bar;q=2');
    expect(values).hasLength(2);
    expect(values![0]!.name).equals('foo');
    expect(values![0]!.q).equals(0);
    expect(values![1]!.name).equals('bar');
    expect(values![1]!.q).equals(1);
  });

  it('sets specificity based on the name', () => {
    const values = readHTTPQualityValues('foo/bar, foo/*, */*, *');
    expect(values).hasLength(4);
    expect(values![0]!.name).equals('foo/bar');
    expect(values![0]!.specificity).equals(2);
    expect(values![1]!.name).equals('foo/*');
    expect(values![1]!.specificity).equals(1);
    expect(values![2]!.name).equals('*/*');
    expect(values![2]!.specificity).equals(0);
    expect(values![3]!.name).equals('*');
    expect(values![3]!.specificity).equals(0);
  });

  it('includes other specifiers in the result', () => {
    const values = readHTTPQualityValues('foo; thing=this; 1=2');
    expect(values).hasLength(1);
    expect(values![0]!.name).equals('foo');
    expect(values![0]!.specifiers).equals(
      new Map([
        ['thing', 'this'],
        ['1', '2'],
      ]),
    );
  });

  it('accepts values pre-split into an array', () => {
    const values = readHTTPQualityValues(['foo;q=0.5', 'bar;q=0.1']);
    expect(values).hasLength(2);
    expect(values![0]!.name).equals('foo');
    expect(values![0]!.q).equals(0.5);
    expect(values![1]!.name).equals('bar');
    expect(values![1]!.q).equals(0.1);
  });
});

describe('readHTTPKeyValues', () => {
  it('reads key value pairs', () => {
    expect(readHTTPKeyValues('foo=bar; 1=2')).equals(
      new Map([
        ['foo', 'bar'],
        ['1', '2'],
      ]),
    );
  });

  it('ignores whitespace between items', () => {
    expect(readHTTPKeyValues('  foo=bar  ; 1=2')).equals(
      new Map([
        ['foo', 'bar'],
        ['1', '2'],
      ]),
    );
  });

  it('lowercases keys', () => {
    expect(readHTTPKeyValues('FOO=BAR')).equals(new Map([['foo', 'BAR']]));
  });

  it('reads quoted values', () => {
    expect(readHTTPKeyValues('foo=" bar;baz "; 1=2')).equals(
      new Map([
        ['foo', ' bar;baz '],
        ['1', '2'],
      ]),
    );
  });

  it('allows escaped characters in quoted values', () => {
    expect(readHTTPKeyValues('foo="bar\\\\;\\"baz"; 1=2')).equals(
      new Map([
        ['foo', 'bar\\;"baz'],
        ['1', '2'],
      ]),
    );
  });

  it('rejects invalid values', () => {
    expect(() => readHTTPKeyValues('foo="')).throws();
    expect(() => readHTTPKeyValues('foo="\\"')).throws();
    expect(() => readHTTPKeyValues(';')).throws();
    expect(() => readHTTPKeyValues('=a')).throws();
  });
});

describe('readHTTPDateSeconds', () => {
  it('reads RFC822 dates', () => {
    expect(readHTTPDateSeconds('Wed, 02 Oct 2002 13:00:00 GMT')).equals(1033563600);
  });

  it('returns undefined for invalid or missing values', () => {
    expect(readHTTPDateSeconds('nope')).isUndefined();
    expect(readHTTPDateSeconds('')).isUndefined();
    expect(readHTTPDateSeconds(['nope'])).isUndefined();
    expect(readHTTPDateSeconds(3)).isUndefined();
    expect(readHTTPDateSeconds(undefined)).isUndefined();
  });
});
