// defends against values which would cause the timeout to be implicitly set to 1 millisecond
export function guardTimeout(value: number, name: string, allowNegative?: boolean) {
  if (value >= 0x80000000 || Number.isNaN(value) || (!allowNegative && value < 0)) {
    throw new RangeError(`${name} must fit in a 31 bit integer - got ${value}`);
  }
}
