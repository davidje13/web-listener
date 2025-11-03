import { internalSplitFirst } from './splitFirst.mts';
import 'lean-test';

describe('splitFirst', () => {
  it('splits a string at the first occurrence of the delimiter', () => {
    expect(internalSplitFirst('foo:bar', ':')).equals(['foo', 'bar']);
  });

  it('ignores subsequent occurrences of the delimiter', () => {
    expect(internalSplitFirst('foo:bar:baz', ':')).equals(['foo', 'bar:baz']);
  });

  it('returns a single item if the delimiter does not appear', () => {
    expect(internalSplitFirst('foo', ':')).equals(['foo']);
  });
});
