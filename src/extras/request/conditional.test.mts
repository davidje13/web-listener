import type { IncomingMessage, ServerResponse } from 'node:http';
import { generateWeakETag } from '../cache/etag.mts';
import { checkIfModified, checkIfRange, compareETag } from './conditional.mts';
import 'lean-test';

describe('checkIfModified', () => {
  it('returns false if the current etag matches if-none-match', () => {
    expect(
      checkIfModified(
        sampleRequest({ 'if-none-match': '"foo"' }),
        sampleResponse({ etag: '"foo"' }),
        BASIC_STATS,
      ),
    ).isFalse();

    expect(
      checkIfModified(
        sampleRequest({ 'if-none-match': '"foo", W/"bar"' }),
        sampleResponse({ etag: 'W/"bar"' }),
        BASIC_STATS,
      ),
    ).isFalse();
  });

  it('returns true if the current etag does not match if-none-match', () => {
    expect(
      checkIfModified(
        sampleRequest({ 'if-none-match': '"nope"' }),
        sampleResponse({ etag: '"foo"' }),
        BASIC_STATS,
      ),
    ).isTrue();

    expect(
      checkIfModified(
        sampleRequest({ 'if-none-match': '"nope", W/"also-nope"' }),
        sampleResponse({ etag: '"foo"' }),
        BASIC_STATS,
      ),
    ).isTrue();
  });

  it('returns false if the modification time is before if-modified-since', () => {
    expect(
      checkIfModified(
        sampleRequest({ 'if-modified-since': new Date(BASIC_STATS.mtimeMs + 1000).toUTCString() }),
        sampleResponse({}),
        BASIC_STATS,
      ),
    ).isFalse();
  });

  it('returns false if the modification time is equal to if-modified-since', () => {
    expect(
      checkIfModified(
        sampleRequest({ 'if-modified-since': new Date(BASIC_STATS.mtimeMs).toUTCString() }),
        sampleResponse({}),
        BASIC_STATS,
      ),
    ).isFalse();
  });

  it('returns true if the modification time is after if-modified-since', () => {
    expect(
      checkIfModified(
        sampleRequest({ 'if-modified-since': new Date(BASIC_STATS.mtimeMs - 1000).toUTCString() }),
        sampleResponse({}),
        BASIC_STATS,
      ),
    ).isTrue();
  });

  it('returns true if the current etag does not match if-none-match even if the modification time is before if-modified-since', () => {
    expect(
      checkIfModified(
        sampleRequest({
          'if-none-match': '"nope"',
          'if-modified-since': new Date(BASIC_STATS.mtimeMs + 1000).toUTCString(),
        }),
        sampleResponse({ etag: '"foo"' }),
        BASIC_STATS,
      ),
    ).isTrue();
  });

  it('returns false if the current etag matches if-none-match even if the modification time is after if-modified-since', () => {
    expect(
      checkIfModified(
        sampleRequest({
          'if-none-match': '"foo"',
          'if-modified-since': new Date(BASIC_STATS.mtimeMs - 1000).toUTCString(),
        }),
        sampleResponse({ etag: '"foo"' }),
        BASIC_STATS,
      ),
    ).isFalse();
  });

  it('returns true if the request does not have if-modified-since or if-none-match', () => {
    expect(
      checkIfModified(sampleRequest({}), sampleResponse({ etag: '"foo"' }), BASIC_STATS),
    ).isTrue();
  });
});

describe('checkIfRange', () => {
  it('returns true if the content matches the requested etag', () => {
    expect(
      checkIfRange(
        sampleRequest({ 'if-range': '"foo"' }),
        sampleResponse({ etag: '"foo"' }),
        BASIC_STATS,
      ),
    ).isTrue();

    expect(
      checkIfRange(
        sampleRequest({ 'if-range': 'W/"foo"' }),
        sampleResponse({ etag: 'W/"foo"' }),
        BASIC_STATS,
      ),
    ).isTrue();

    expect(
      checkIfRange(
        sampleRequest({ 'if-range': generateWeakETag('foo/bar', BASIC_STATS) }),
        sampleResponse({ 'content-encoding': 'foo/bar' }),
        BASIC_STATS,
      ),
    ).isTrue();
  });

  it('returns false if the content does not match the requested etag', () => {
    expect(
      checkIfRange(
        sampleRequest({ 'if-range': '"foo1"' }),
        sampleResponse({ etag: '"foo2"' }),
        BASIC_STATS,
      ),
    ).isFalse();

    expect(
      checkIfRange(
        sampleRequest({ 'if-range': 'W/"foo1"' }),
        sampleResponse({ etag: 'W/"foo2"' }),
        BASIC_STATS,
      ),
    ).isFalse();

    expect(
      checkIfRange(
        sampleRequest({ 'if-range': generateWeakETag('foo/bar', { ...BASIC_STATS, size: 20 }) }),
        sampleResponse({ 'content-encoding': 'foo/bar' }),
        BASIC_STATS,
      ),
    ).isFalse();

    expect(
      checkIfRange(
        sampleRequest({ 'if-range': generateWeakETag('foo/bar', BASIC_STATS) }),
        sampleResponse({ 'content-encoding': 'foo/baz' }),
        BASIC_STATS,
      ),
    ).isFalse();
  });

  it('returns true if the content matches the requested modified time', () => {
    expect(
      checkIfRange(
        sampleRequest({ 'if-range': new Date(BASIC_STATS.mtimeMs).toUTCString() }),
        sampleResponse({}),
        BASIC_STATS,
      ),
    ).isTrue();
  });

  it('returns false if the content does not match the requested modified time', () => {
    expect(
      checkIfRange(
        sampleRequest({ 'if-range': new Date(BASIC_STATS.mtimeMs + 1000).toUTCString() }),
        sampleResponse({}),
        BASIC_STATS,
      ),
    ).isFalse();
  });

  it('returns true if the request does not have if-range', () => {
    expect(checkIfRange(sampleRequest({}), sampleResponse({}), BASIC_STATS)).isTrue();
  });
});

describe('compareETag', () => {
  it('returns true if any of the given etags match the response etag header', () => {
    expect(compareETag(sampleResponse({ etag: '"foo"' }), BASIC_STATS, ['"foo"'])).isTrue();
    expect(compareETag(sampleResponse({ etag: 'W/"foo"' }), BASIC_STATS, ['W/"foo"'])).isTrue();
    expect(
      compareETag(sampleResponse({ etag: 'W/"foo"' }), BASIC_STATS, ['"nope"', 'W/"foo"']),
    ).isTrue();
  });

  it('returns true if any of the given etags match a generated weak etag for the response', () => {
    expect(
      compareETag(sampleResponse({ 'content-encoding': 'foo/bar' }), BASIC_STATS, [
        generateWeakETag('foo/bar', BASIC_STATS),
      ]),
    ).isTrue();

    expect(
      compareETag(sampleResponse({ 'content-encoding': 'foo/bar', etag: '"nope"' }), BASIC_STATS, [
        generateWeakETag('foo/bar', BASIC_STATS),
      ]),
    ).isTrue();

    expect(
      compareETag(sampleResponse({ 'content-encoding': 'foo/bar' }), BASIC_STATS, [
        '"nope"',
        'W/"nope"',
        generateWeakETag('foo/bar', BASIC_STATS),
      ]),
    ).isTrue();

    expect(
      compareETag(sampleResponse({}), BASIC_STATS, [generateWeakETag(undefined, BASIC_STATS)]),
    ).isTrue();
  });

  it('does not try generating a weak etag if the response already has a weak etag', () => {
    expect(
      compareETag(
        sampleResponse({ 'content-encoding': 'foo/bar', etag: 'W/"nope"' }),
        BASIC_STATS,
        [generateWeakETag('foo/bar', BASIC_STATS)],
      ),
    ).isFalse();
  });

  it('returns false if none of the given etags match the response', () => {
    expect(compareETag(sampleResponse({ etag: '"foo1"' }), BASIC_STATS, ['"foo2"'])).isFalse();
    expect(compareETag(sampleResponse({ etag: 'W/"foo1"' }), BASIC_STATS, ['W/"foo2"'])).isFalse();
    expect(
      compareETag(sampleResponse({ etag: 'W/"foo"' }), BASIC_STATS, ['"nope"', 'W/"also-no"']),
    ).isFalse();
    expect(compareETag(sampleResponse({}), BASIC_STATS, ['"nope"', 'W/"also-no"'])).isFalse();
  });

  it('returns true if any of the given etags are a wildcard', () => {
    expect(compareETag(sampleResponse({ etag: '"foo"' }), BASIC_STATS, ['*'])).isTrue();
    expect(compareETag(sampleResponse({ etag: '"foo"' }), BASIC_STATS, ['"nope"', '*'])).isTrue();
    expect(compareETag(sampleResponse({}), BASIC_STATS, ['*'])).isTrue();
  });
});

const BASIC_STATS = { mtimeMs: Date.UTC(2020, 1, 2, 3, 4, 5, 678), size: 10 };

function sampleRequest(headers: Record<string, string | undefined>) {
  return { headers } as IncomingMessage;
}

function sampleResponse(headers: Record<string, string | undefined>) {
  return {
    getHeader: (name: string) => headers[name.toLowerCase()],
  } as ServerResponse;
}
