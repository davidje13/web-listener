export const internalOverrideFlags = (pattern: RegExp, caseInsensitive: boolean) =>
  new RegExp(
    pattern,
    (pattern.unicodeSets ? 'v' : pattern.unicode ? 'u' : '') +
      (pattern.ignoreCase || caseInsensitive ? 'i' : ''),
  );
