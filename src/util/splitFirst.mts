export function internalSplitFirst(data: string, delimiter: string): [string, string?] {
  const sep = data.indexOf(delimiter);
  if (sep === -1) {
    return [data];
  }
  return [data.substring(0, sep), data.substring(sep + delimiter.length)];
}
