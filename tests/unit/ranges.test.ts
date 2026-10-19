import {
  addIndex,
  capRanges,
  containsIndex,
  contiguousPrefixEnd,
  countInRanges,
  missingRanges,
  normalizeRanges,
  rangesFromIndexes,
} from "@/lib/utils/ranges";

describe("chunk ranges", () => {
  it("normalizes: sorts, merges overlapping and adjacent ranges, drops invalid ones", () => {
    expect(normalizeRanges([[8, 12], [0, 5], [6, 6], [3, 4], [20, 10], [-1, 2]])).toEqual([
      [0, 6],
      [8, 12],
    ]);
  });

  it("builds ranges from indexes", () => {
    expect(rangesFromIndexes([5, 1, 2, 3, 9, 10])).toEqual([
      [1, 3],
      [5, 5],
      [9, 10],
    ]);
    expect(rangesFromIndexes([])).toEqual([]);
  });

  it("adds an index and counts", () => {
    const ranges = addIndex([[0, 2], [4, 6]], 3);
    expect(ranges).toEqual([[0, 6]]);
    expect(countInRanges(ranges)).toBe(7);
  });

  it("finds membership with binary search", () => {
    const ranges = normalizeRanges([[0, 2], [10, 20], [30, 30]]);
    expect(containsIndex(ranges, 0)).toBe(true);
    expect(containsIndex(ranges, 15)).toBe(true);
    expect(containsIndex(ranges, 30)).toBe(true);
    expect(containsIndex(ranges, 5)).toBe(false);
    expect(containsIndex(ranges, 31)).toBe(false);
  });

  it("computes the gaps to send on resume", () => {
    expect(missingRanges([[0, 511], [520, 600]], 1280)).toEqual([
      [512, 519],
      [601, 1279],
    ]);
    expect(missingRanges([], 3)).toEqual([[0, 2]]);
    expect(missingRanges([[0, 2]], 3)).toEqual([]);
  });

  it("caps to the backend's 1024-range limit by dropping the smallest islands", () => {
    const islands = Array.from({ length: 2000 }, (_, i): [number, number] => [i * 3, i * 3 + (i % 2)]);
    const capped = capRanges(islands);
    expect(capped.length).toBeLessThanOrEqual(1024);
    // Never claims chunks it does not hold.
    for (const [a, b] of capped) {
      for (let i = a; i <= b; i += 1) expect(containsIndex(normalizeRanges(islands), i)).toBe(true);
    }
  });

  it("reports the contiguous verified prefix", () => {
    expect(contiguousPrefixEnd([[0, 9], [12, 20]])).toBe(9);
    expect(contiguousPrefixEnd([[1, 9]])).toBeNull();
    expect(contiguousPrefixEnd([])).toBeNull();
  });
});
