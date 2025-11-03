import { getMime, decompressMime, registerMime, readMimeTypes } from './mime.mts';
import 'lean-test';

describe('getMime', () => {
  it('reports common mime types from file extensions', () => {
    expect(getMime('.bin')).equals('application/octet-stream');
    expect(getMime('.gz')).equals('application/gzip');
    expect(getMime('.gzip')).equals('application/gzip');
    expect(getMime('.json')).equals('application/json');
    expect(getMime('.png')).equals('image/png');
    expect(getMime('.svg')).equals('image/svg+xml');
    expect(getMime('.wav')).equals('audio/wave');
  });

  it('allows lookups with and without a leading dot', () => {
    expect(getMime('wav')).equals('audio/wave');
    expect(getMime('.wav')).equals('audio/wave');
  });

  it('populates charset for text mimes', () => {
    expect(getMime('txt')).equals('text/plain; charset=utf-8');
    expect(getMime('txt', 'custom')).equals('text/plain; charset=custom');
    expect(getMime('js')).equals('text/javascript; charset=utf-8');
    expect(getMime('mjs')).equals('text/javascript; charset=utf-8');
    expect(getMime('md')).equals('text/markdown; charset=utf-8');
    expect(getMime('rtf')).equals('text/rtf; charset=utf-8');
  });

  it('returns application/octet-stream for unknown types', () => {
    expect(getMime('nope')).equals('application/octet-stream');
  });
});

describe('registerMime', () => {
  it('registers extra mime types', () => {
    registerMime(new Map([['xyz', 'custom/thing']]));
    expect(getMime('xyz')).equals('custom/thing');
  });

  it('adds charset to custom text mime types', () => {
    registerMime(new Map([['foo', 'text/this']]));
    expect(getMime('foo')).equals('text/this; charset=utf-8');
  });

  it('does not add charset to custom text mime types which already include it', () => {
    registerMime(new Map([['bar', 'text/this; charset=woo']]));
    expect(getMime('bar')).equals('text/this; charset=woo');
  });
});

describe('readMimeTypes', () => {
  it('reads Apache .types formatted mime mappings', () => {
    const parsed = readMimeTypes(`
      # Comment
      text/foo foo
      text/bar x y z
      # text/baz old
      no/map

      another/one 1
    `);
    expect(parsed).equals(
      new Map([
        ['foo', 'text/foo'],
        ['x', 'text/bar'],
        ['y', 'text/bar'],
        ['z', 'text/bar'],
        ['1', 'another/one'],
      ]),
    );
  });
});

describe('decompressMime', () => {
  it('splits compressed mime definitions into a map', () => {
    const decompressed = decompressMime('blah,wh(a)t=another/thing');
    expect(decompressed).equals(
      new Map([
        ['blah', 'another/thing'],
        ['what', 'another/thing'],
        ['wht', 'another/thing'],
      ]),
    );
  });
});
