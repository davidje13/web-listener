export const internalOverrideFlags = (pattern: RegExp, caseInsensitive: boolean) =>
  new RegExp(
    pattern,
    (pattern.unicodeSets ? 'v' : pattern.unicode ? 'u' : '') +
      (pattern.ignoreCase || caseInsensitive ? 'i' : ''),
  );

export const stringPredicate = (
  conditions: (string | RegExp)[] | string | RegExp | undefined,
  caseInsensitive: boolean,
): ((value: string) => boolean) => {
  if (conditions === undefined) {
    return () => true;
  }
  if (!Array.isArray(conditions)) {
    conditions = [conditions];
  }
  if (!conditions.length) {
    return () => false;
  }
  if (conditions.length === 1) {
    const condition = conditions[0]!;
    if (typeof condition === 'string') {
      if (caseInsensitive) {
        const lower = condition.toLowerCase();
        return (value) => value.toLowerCase() === lower;
      } else {
        return (value) => value === condition;
      }
    }
    const pattern = internalOverrideFlags(condition, caseInsensitive);
    return (value) => pattern.test(value);
  }

  const simple = new Set();
  const patterns: RegExp[] = [];
  for (const condition of conditions) {
    if (typeof condition === 'string') {
      if (caseInsensitive) {
        simple.add(condition.toLowerCase());
      } else {
        simple.add(condition);
      }
    } else {
      patterns.push(internalOverrideFlags(condition, caseInsensitive));
    }
  }
  return (v) =>
    simple.has(caseInsensitive ? v.toLowerCase() : v) || patterns.some((p) => p.test(v));
};
