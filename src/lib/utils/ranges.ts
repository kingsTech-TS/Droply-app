// Inclusive chunk ranges, as the backend's checkpoint API uses them: [[0, 5], [8, 12]].
import type { ChunkRange } from "@/types/transfer";

export const MAX_CHECKPOINT_RANGES = 1024;

/** Sorts and merges overlapping or adjacent ranges. */
export function normalizeRanges(ranges: readonly ChunkRange[]): ChunkRange[] {
  const sorted = ranges
    .filter(([a, b]) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= a)
    .map(([a, b]): ChunkRange => [a, b])
    .sort((x, y) => x[0] - y[0]);
  const out: ChunkRange[] = [];
  for (const range of sorted) {
    const last = out[out.length - 1];
    if (last && range[0] <= last[1] + 1) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      out.push(range);
    }
  }
  return out;
}

export function rangesFromIndexes(indexes: Iterable<number>): ChunkRange[] {
  return normalizeRanges(Array.from(indexes, (i): ChunkRange => [i, i]));
}

export function addIndex(ranges: readonly ChunkRange[], index: number): ChunkRange[] {
  return normalizeRanges([...ranges, [index, index]]);
}

export function countInRanges(ranges: readonly ChunkRange[]): number {
  return ranges.reduce((sum, [a, b]) => sum + (b - a + 1), 0);
}

export function containsIndex(ranges: readonly ChunkRange[], index: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const range = ranges[mid];
    if (!range) return false;
    if (index < range[0]) hi = mid - 1;
    else if (index > range[1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Chunk indexes in [0, total) that are not covered by `have`, in order. */
export function missingRanges(have: readonly ChunkRange[], total: number): ChunkRange[] {
  const out: ChunkRange[] = [];
  let next = 0;
  for (const [a, b] of normalizeRanges(have)) {
    if (a >= total) break;
    if (a > next) out.push([next, a - 1]);
    next = Math.max(next, b + 1);
  }
  if (next < total) out.push([next, total - 1]);
  return out;
}

/**
 * Keeps at most `max` ranges for a checkpoint. Dropping the smallest islands only
 * under-reports what the receiver holds, so the sender re-sends a little more, which is safe.
 */
export function capRanges(ranges: readonly ChunkRange[], max = MAX_CHECKPOINT_RANGES): ChunkRange[] {
  const normal = normalizeRanges(ranges);
  if (normal.length <= max) return normal;
  const keep = [...normal]
    .sort((x, y) => y[1] - y[0] - (x[1] - x[0]))
    .slice(0, max);
  return normalizeRanges(keep);
}

/** Highest index such that every chunk from 0 to it is held, or null. */
export function contiguousPrefixEnd(ranges: readonly ChunkRange[]): number | null {
  const first = normalizeRanges(ranges)[0];
  return first && first[0] === 0 ? first[1] : null;
}
