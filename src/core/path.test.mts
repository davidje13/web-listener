import { internalCompilePathPattern, type NamedPathParameter } from './path.mts';
import 'lean-test';

describe('compilePathPattern', () => {
  it('creates a regular expression for matching a path', () => {
    const path = internalCompilePathPattern('/foo/bar', false);
    expect(path._pattern.test('/foo/bar')).isTrue();
    expect(path._pattern.test('/foo/bar/')).isFalse();
    expect(path._pattern.test('/foobar')).isFalse();
    expect(path._pattern.test('/foo/barbaz')).isFalse();
    expect(path._pattern.test('/foo/bar/baz')).isFalse();
    expect(path._pattern.test('/foo')).isFalse();
    expect(path._pattern.test('/foo/nope')).isFalse();
  });

  it('matches trailing slashes', () => {
    const path = internalCompilePathPattern('/foo/bar/', false);
    expect(path._pattern.test('/foo/bar/')).isTrue();
    expect(path._pattern.test('/foo/bar')).isFalse();
  });

  it('allows sub-routes if configured', () => {
    const path = internalCompilePathPattern('/foo/bar', true);
    expect(path._pattern.test('/foo/bar')).isTrue();
    expect(path._pattern.test('/foo/bar/')).isTrue();
    expect(path._pattern.test('/foo/bar/baz')).isTrue();
    expect(path._pattern.test('/foo/barbaz')).isFalse();
    expect(path._pattern.test('/foo/barbaz/')).isFalse();
    expect(path._pattern.test('/foo/barbaz/nope')).isFalse();
    expect(path._pattern.test('/foo')).isFalse();
    expect(path._pattern.test('/foo/nope')).isFalse();
    expect(path._pattern.test('/foo/nope/baz')).isFalse();

    expect(getRest(path, '/foo/bar/baz/woo')).equals('baz/woo');
    expect(getRest(path, '/foo/bar')).equals('');
    expect(getRest(path, '/foo/bar/')).equals('');

    expect(getRest(path, '/foo/bar///baz/woo')).equals('baz/woo');
    expect(getRest(path, '/foo/bar///')).equals('');
  });

  it('allows sub-routes after trailing slashes', () => {
    const path = internalCompilePathPattern('/foo/bar/', true);
    expect(path._pattern.test('/foo/bar')).isFalse();
    expect(path._pattern.test('/foo/barbaz')).isFalse();
    expect(path._pattern.test('/foo/bar/')).isTrue();
    expect(path._pattern.test('/foo/bar/baz')).isTrue();

    expect(getRest(path, '/foo/bar/baz')).equals('baz');
    expect(getRest(path, '/foo/bar/')).equals('');

    expect(getRest(path, '/foo/bar///baz')).equals('baz');
    expect(getRest(path, '/foo/bar///')).equals('');
  });

  it('supports optional components', () => {
    const path = internalCompilePathPattern('/foo{/bar}', false);
    expect(path._pattern.test('/foo/bar')).isTrue();
    expect(path._pattern.test('/foo/bar/')).isFalse();
    expect(path._pattern.test('/foo')).isTrue();
    expect(path._pattern.test('/foo/nope')).isFalse();
  });

  it('supports optional components after the first /', () => {
    const path = internalCompilePathPattern('/{foo/}bar', false);
    expect(path._pattern.test('/foo/bar')).isTrue();
    expect(path._pattern.test('/bar')).isTrue();
    expect(path._pattern.test('/foo')).isFalse();
  });

  it('supports optional trailing slashes', () => {
    const path = internalCompilePathPattern('/foo/bar{/}', false);
    expect(path._pattern.test('/foo/bar/')).isTrue();
    expect(path._pattern.test('/foo/bar')).isTrue();
    expect(path._pattern.test('/foo/bar/baz')).isFalse();
    expect(path._pattern.test('/foo')).isFalse();
  });

  it('escapes special characters with backslash', () => {
    const path = internalCompilePathPattern('/foo\\*', false);
    expect(path._pattern.test('/foo*')).isTrue();
    expect(path._pattern.test('/foo')).isFalse();
    expect(path._pattern.test('/foo/')).isFalse();
    expect(path._pattern.test('/foo.')).isFalse();
  });

  it('allows sub-routes after optional trailing slashes', () => {
    const path = internalCompilePathPattern('/foo/bar{/}', true);
    expect(path._pattern.test('/foo/bar')).isTrue();
    expect(path._pattern.test('/foo/barbaz')).isFalse();
    expect(path._pattern.test('/foo/bar/')).isTrue();
    expect(path._pattern.test('/foo/bar/baz')).isTrue();

    expect(getRest(path, '/foo/bar/baz')).equals('baz');
    expect(getRest(path, '/foo/bar/')).equals('');
    expect(getRest(path, '/foo/bar')).equals('');

    expect(getRest(path, '/foo/bar///baz')).equals('baz');
    expect(getRest(path, '/foo/bar///')).equals('');
  });

  it('supports nested optional components', () => {
    const path = internalCompilePathPattern('/foo{/bar{/baz}}', false);
    expect(path._pattern.test('/foo')).isTrue();
    expect(path._pattern.test('/foo/bar')).isTrue();
    expect(path._pattern.test('/foo/bar/baz')).isTrue();
    expect(path._pattern.test('/foo/bar/nope')).isFalse();
    expect(path._pattern.test('/foo/baz')).isFalse();
  });

  it('supports path parameters', () => {
    const path = internalCompilePathPattern('/foo/:bar/baz', false);
    expect(path._pattern.test('/foo/one/baz')).isTrue();
    expect(path._pattern.test('/foo/one/nope')).isFalse();
    expect(path._pattern.test('/foo/two/baz')).isTrue();
    expect(path._pattern.test('/foo//baz')).isFalse();
    expect(path._pattern.test('/foo/baz')).isFalse();
    expect(path._pattern.test('/bar/one/baz')).isFalse();

    expect(getPathParameters(path, '/foo/one/baz')).equals(new Map([['bar', 'one']]));
    expect(getPathParameters(path, '/foo/two/baz')).equals(new Map([['bar', 'two']]));
  });

  it('supports optional path parameters', () => {
    const path = internalCompilePathPattern('/foo{/:bar}/baz', false);
    expect(path._pattern.test('/foo/one/baz')).isTrue();
    expect(path._pattern.test('/foo/one/nope')).isFalse();
    expect(path._pattern.test('/foo/two/baz')).isTrue();
    expect(path._pattern.test('/foo/baz')).isTrue();
    expect(path._pattern.test('/bar/baz/one')).isFalse();
    expect(path._pattern.test('/foo/nope')).isFalse();

    expect(getPathParameters(path, '/foo/one/baz')).equals(new Map([['bar', 'one']]));
    expect(getPathParameters(path, '/foo/baz')).equals(new Map([['bar', undefined]]));
  });

  it('permits any name for path parameters', () => {
    const path = internalCompilePathPattern('/foo{/:__proto__}', false);

    expect(getPathParameters(path, '/foo/bar')).equals(new Map([['__proto__', 'bar']]));
    expect(getPathParameters(path, '/foo')).equals(new Map([['__proto__', undefined]]));
  });

  it('supports partial component path parameters', () => {
    const path = internalCompilePathPattern('/foo-:thing-bar', false);
    expect(path._pattern.test('/foo-one-bar')).isTrue();
    expect(path._pattern.test('/foo-two-bar')).isTrue();
    expect(path._pattern.test('/foo--bar')).isFalse();
    expect(path._pattern.test('/foo-one-nope')).isFalse();
    expect(path._pattern.test('/nope-one-bar')).isFalse();

    expect(getPathParameters(path, '/foo-one-bar')).equals(new Map([['thing', 'one']]));
  });

  it('supports multi-component path parameters', () => {
    const path = internalCompilePathPattern('/foo/*bar', false);
    expect(path._pattern.test('/foo/')).isTrue();
    expect(path._pattern.test('/foo/one')).isTrue();
    expect(path._pattern.test('/foo/one/two/three')).isTrue();
    expect(path._pattern.test('/foo')).isFalse();
    expect(path._pattern.test('/bar/one/')).isFalse();

    expect(getPathParameters(path, '/foo/one/two')).equals(new Map([['bar', ['one', 'two']]]));
    expect(getPathParameters(path, '/foo/')).equals(new Map([['bar', []]]));
  });

  it('rejects unbalanced brackets', () => {
    expect(() => internalCompilePathPattern('/foo{/bar', false)).throws(
      'unbalanced optional braces in path',
    );

    expect(() => internalCompilePathPattern('/foo/bar}', false)).throws(
      'unbalanced optional braces in path',
    );
  });

  it('rejects invalid paths', () => {
    expect(() => internalCompilePathPattern('nope/foo', false)).throws(
      "path must begin with '/' or flags",
    );

    expect(() => internalCompilePathPattern('/foo/:/', false)).throws(
      "unnamed parameter or unescaped ':' at 5",
    );

    expect(() => internalCompilePathPattern('/x/*/', false)).throws(
      "unnamed parameter or unescaped '*' at 3",
    );
  });

  it('rejects paths with an optional leading /', () => {
    expect(() => internalCompilePathPattern('{/}foo', false)).throws(
      "path must begin with '/' or flags",
    );
  });

  it('is case sensitive by default', () => {
    const path = internalCompilePathPattern('/foo/BAR', false);
    expect(path._pattern.test('/foo/BAR')).isTrue();
    expect(path._pattern.test('/FOO/bar')).isFalse();
    expect(path._pattern.test('/foo/bar')).isFalse();
    expect(path._pattern.test('/FOO/BAR')).isFalse();
  });

  it('is case insensitive if "i" is specified', () => {
    const path = internalCompilePathPattern('i/foo/BAR', false);
    expect(path._pattern.test('/foo/BAR')).isTrue();
    expect(path._pattern.test('/FOO/bar')).isTrue();
    expect(path._pattern.test('/foo/bar')).isTrue();
    expect(path._pattern.test('/FOO/BAR')).isTrue();
    expect(path._pattern.test('/FOO/BAR/')).isFalse();
    expect(path._pattern.test('/nope')).isFalse();
  });

  it('merges slashes by default', () => {
    const path = internalCompilePathPattern('/foo/bar', false);
    expect(path._pattern.test('/foo/bar')).isTrue();
    expect(path._pattern.test('/foo//bar')).isTrue();
    expect(path._pattern.test('///foo//bar')).isTrue();
    expect(path._pattern.test('/foo/bar/')).isFalse();
  });

  it('checks for at-least-n slashes if multiple are in the pattern', () => {
    const path = internalCompilePathPattern('/foo//bar', false);
    expect(path._pattern.test('/foo/bar')).isFalse();
    expect(path._pattern.test('/foo//bar')).isTrue();
    expect(path._pattern.test('/foo///bar')).isTrue();
    expect(path._pattern.test('//foo//bar')).isTrue();
    expect(path._pattern.test('//foo/bar')).isFalse();
  });

  it('matches slashes exactly if "!" is specified', () => {
    const path = internalCompilePathPattern('!/foo//bar', false);
    expect(path._pattern.test('/foo/bar')).isFalse();
    expect(path._pattern.test('/foo//bar')).isTrue();
    expect(path._pattern.test('///foo//bar')).isFalse();
    expect(path._pattern.test('/foo/bar/')).isFalse();
  });

  it('allows slashes at start of sub-routes if "!" is specified', () => {
    const pathNoSlash = internalCompilePathPattern('!/foo', true);
    expect(getRest(pathNoSlash, '/foo/bar')).equals('bar');
    expect(getRest(pathNoSlash, '/foo//bar')).equals('/bar');
    expect(getRest(pathNoSlash, '/foo//')).equals('/');
    expect(getRest(pathNoSlash, '/foo/')).equals('');
    expect(getRest(pathNoSlash, '/foo')).equals('');

    const pathSlash = internalCompilePathPattern('!/foo/', true);
    expect(getRest(pathSlash, '/foo/bar')).equals('bar');
    expect(getRest(pathSlash, '/foo//bar')).equals('/bar');
    expect(getRest(pathSlash, '/foo//')).equals('/');
    expect(getRest(pathSlash, '/foo/')).equals('');
    expect(getRest(pathSlash, '/foo')).equals('');

    const pathOptional = internalCompilePathPattern('!/foo{/}', true);
    expect(getRest(pathOptional, '/foo/bar')).equals('bar');
    expect(getRest(pathOptional, '/foo//bar')).equals('/bar');
    expect(getRest(pathOptional, '/foo//')).equals('/');
    expect(getRest(pathOptional, '/foo/')).equals('');
    expect(getRest(pathOptional, '/foo')).equals('');
  });
});

function getPathParameters(
  test: {
    _pattern: RegExp;
    _parameters: NamedPathParameter[];
  },
  path: string,
) {
  const match = test._pattern.exec(path);
  if (!match) {
    return null;
  }
  const result = new Map<string, unknown>();
  for (let i = 0; i < test._parameters.length; ++i) {
    const p = test._parameters[i]!;
    const v = match[i + 1];
    result.set(p._name, p._reader(v));
  }
  return result;
}

function getRest(test: { _pattern: RegExp }, path: string) {
  return test._pattern.exec(path)?.groups?.['rest'] ?? '';
}
