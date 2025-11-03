import { internalOverrideFlags } from './regexpFlags.mts';
import 'lean-test';

describe('overrideFlags', () => {
  it('removes indices, global, multiline, dotAll, and sticky flags', () => {
    const input = /./dgmsy;
    const output = internalOverrideFlags(input, false);
    expect(output.hasIndices).isFalse();
    expect(output.global).isFalse();
    expect(output.multiline).isFalse();
    expect(output.dotAll).isFalse();
    expect(output.sticky).isFalse();
  });

  it('preserves unicode flags', () => {
    expect(internalOverrideFlags(/./v, false).unicodeSets).isTrue();
    expect(internalOverrideFlags(/./u, false).unicode).isTrue();
    expect(internalOverrideFlags(/./, false).unicode).isFalse();
  });

  it('preserves case insensitivity or adds it', () => {
    expect(internalOverrideFlags(/./i, false).ignoreCase).isTrue();
    expect(internalOverrideFlags(/./, false).ignoreCase).isFalse();
    expect(internalOverrideFlags(/./, true).ignoreCase).isTrue();
  });

  it('preserves the pattern', () => {
    expect(internalOverrideFlags(/blah.*/i, false).source).equals('blah.*');
  });
});
