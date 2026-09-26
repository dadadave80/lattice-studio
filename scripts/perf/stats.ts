// Summary statistics for the benchmarks (brief Q4). Pure.
import type { Stats } from "./types.ts";

/** The `p`-th percentile (0-100) of `sorted` (ascending), nearest rank. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? Number.NaN;
}

/** The median of `values` (the mean of the middle two for an even count). NaN when empty. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? Number.NaN;
  return sorted.length % 2 === 1 ? hi : ((sorted[mid - 1] ?? hi) + hi) / 2;
}

/** Count, mean, median, p95, min and max of `values`. */
export function summarize(values: readonly number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    n,
    mean: n === 0 ? Number.NaN : sorted.reduce((sum, v) => sum + v, 0) / n,
    median: median(sorted),
    p95: percentile(sorted, 95),
    min: sorted[0] ?? Number.NaN,
    max: sorted[n - 1] ?? Number.NaN,
  };
}
