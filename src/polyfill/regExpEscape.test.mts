import { internalRegExpEscape } from './regExpEscape.mts';
import 'lean-test';

describe('regExpEscape', () => {
  it('escapes special RegExp characters', () => {
    const test = 'specials.^$\\[]{}()| zwj\u200D';
    const escaped = internalRegExpEscape(test);
    expect(escaped).not(equals(test));
    expect(new RegExp(escaped).test(test)).isTrue();
  });
});
