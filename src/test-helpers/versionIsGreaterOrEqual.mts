export const versionIsGreaterOrEqual = (minimum: string) => (version: string) => {
  const minParts = splitVersion(minimum);
  const verParts = splitVersion(version);
  for (let i = 0; i < minParts.length; ++i) {
    const ver = verParts[i] ?? 0;
    const min = minParts[i]!;
    if (ver > min) {
      return { pass: true, message: `required below version ${minimum}, got ${version}` };
    }
    if (ver < min) {
      return { pass: false, message: `required at least version ${minimum}, got ${version}` };
    }
  }
  return { pass: true, message: `required below version ${minimum}, got ${version}` };
};

const splitVersion = (v: string) => (v[0] === 'v' ? v.substring(1) : v).split('.').map(Number);
