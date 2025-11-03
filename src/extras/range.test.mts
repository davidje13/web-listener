import { simplifyRange } from './range.mts';
import 'lean-test';

describe('simplifyRange', () => {
  it('combines nearby ranges', () => {
    const simplified = simplifyRange({
      ranges: [
        { start: 100, end: 500 },
        { start: 520, end: 800 },
      ],
      totalSize: 5000,
    });
    expect(simplified).equals({ ranges: [{ start: 100, end: 800 }], totalSize: 5000 });
  });

  it('does not modify the input', () => {
    const input = {
      ranges: [
        { start: 100, end: 500 },
        { start: 520, end: 800 },
      ],
      totalSize: 5000,
    };
    simplifyRange(input);
    expect(input).equals({
      ranges: [
        { start: 100, end: 500 },
        { start: 520, end: 800 },
      ],
      totalSize: 5000,
    });
  });

  it('does nothing to empty ranges', () => {
    const simplified = simplifyRange({ ranges: [], totalSize: 5000 });
    expect(simplified).equals({ ranges: [], totalSize: 5000 });
  });

  it('does nothing to single ranges', () => {
    const simplified = simplifyRange({ ranges: [{ start: 100, end: 500 }], totalSize: 5000 });
    expect(simplified).equals({ ranges: [{ start: 100, end: 500 }], totalSize: 5000 });
  });

  it('preserves distant ranges', () => {
    const simplified = simplifyRange({
      ranges: [
        { start: 100, end: 500 },
        { start: 2000, end: 3000 },
      ],
      totalSize: 5000,
    });
    expect(simplified).equals({
      ranges: [
        { start: 100, end: 500 },
        { start: 2000, end: 3000 },
      ],
      totalSize: 5000,
    });
  });

  it('combines multiple ranges', () => {
    const simplified = simplifyRange({
      ranges: [
        { start: 100, end: 500 },
        { start: 50, end: 200 },
        { start: 1000, end: 1100 },
        { start: 2000, end: 3000 },
        { start: 1100, end: 2000 },
        { start: 510, end: 510 },
      ],
      totalSize: 5000,
    });
    expect(simplified).equals({
      ranges: [
        { start: 50, end: 510 },
        { start: 1000, end: 3000 },
      ],
      totalSize: 5000,
    });
  });

  it('preserves ordering by default', () => {
    const simplified = simplifyRange({
      ranges: [
        { start: 2000, end: 3000 },
        { start: 100, end: 500 },
      ],
      totalSize: 5000,
    });
    expect(simplified).equals({
      ranges: [
        { start: 2000, end: 3000 },
        { start: 100, end: 500 },
      ],
      totalSize: 5000,
    });
  });

  it('reorders ranges if forceSequential is true', () => {
    const simplified = simplifyRange(
      {
        ranges: [
          { start: 2000, end: 3000 },
          { start: 100, end: 500 },
        ],
        totalSize: 5000,
      },
      { forceSequential: true },
    );
    expect(simplified).equals({
      ranges: [
        { start: 100, end: 500 },
        { start: 2000, end: 3000 },
      ],
      totalSize: 5000,
    });
  });

  it('does not combine ranges if mergeOverlapDistance is negative', () => {
    const simplified = simplifyRange(
      {
        ranges: [
          { start: 100, end: 500 },
          { start: 200, end: 800 },
        ],
        totalSize: 5000,
      },
      { mergeOverlapDistance: -1 },
    );
    expect(simplified).equals({
      ranges: [
        { start: 100, end: 500 },
        { start: 200, end: 800 },
      ],
      totalSize: 5000,
    });
  });

  it('only merges touching ranges if mergeOverlapDistance is 0', () => {
    const simplified = simplifyRange(
      {
        ranges: [
          { start: 100, end: 199 },
          { start: 200, end: 299 },
          { start: 301, end: 499 },
        ],
        totalSize: 5000,
      },
      { mergeOverlapDistance: 0 },
    );
    expect(simplified).equals({
      ranges: [
        { start: 100, end: 299 },
        { start: 301, end: 499 },
      ],
      totalSize: 5000,
    });
  });
});
