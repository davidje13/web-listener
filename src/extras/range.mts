export interface HTTPRange {
  /** A list of ranges. May not be in order and/or include overlapping ranges. */
  ranges: RangePart[];
  /** The total size of the resource, for anchoring negative values in ranges. */
  totalSize?: number | undefined;
}

export interface RangePart {
  /** The start of the range (inclusive). Negative values count from the end of the content. */
  start: number;
  /** The end of the range (inclusive). Negative values count from the end of the content. */
  end: number;
}

export interface SimplifyRangeOptions {
  /**
   * Re-order all ranges so that the start indices are increasing.
   * @default false
   */
  forceSequential?: boolean | undefined;
  /**
   * Combine any ranges which are within this distance.
   * Set to 0 to only merge ranges which touch or overlap.
   * Set to -1 to not merge any ranges.
   * @default 100
   */
  mergeOverlapDistance?: number | undefined;
}

export function simplifyRange(
  original: HTTPRange,
  { forceSequential = false, mergeOverlapDistance = 100 }: SimplifyRangeOptions = {},
): HTTPRange {
  const ranges: RangePart[] = [];
  if (mergeOverlapDistance >= 0) {
    for (const range of original.ranges) {
      let merged: RangePart | null = null;
      let del = 0;
      for (let i = 0; i < ranges.length; ++i) {
        const existingRange = ranges[i]!;
        if (
          range.end >= existingRange.start - mergeOverlapDistance - 1 &&
          existingRange.end >= range.start - mergeOverlapDistance - 1
        ) {
          if (merged) {
            ++del;
            merged.start = Math.min(merged.start, existingRange.start);
            merged.end = Math.max(merged.end, existingRange.end);
          } else {
            merged = existingRange;
            merged.start = Math.min(merged.start, range.start);
            merged.end = Math.max(merged.end, range.end);
          }
        } else if (del > 0) {
          ranges[i - del] = existingRange;
        }
      }
      if (merged) {
        ranges.length -= del;
      } else {
        ranges.push({ ...range });
      }
    }
  } else {
    ranges.push(...original.ranges);
  }
  if (forceSequential) {
    for (let i = 0; i < ranges.length - 1; ++i) {
      if (ranges[i]!.start > ranges[i + 1]!.start) {
        ranges.sort((a, b) => a.start - b.start);
        break;
      }
    }
  }
  return { ranges, totalSize: original.totalSize };
}
