import { describe, expect, test } from "bun:test";
import { median, percentile, summarize } from "./stats.ts";

describe("stats", () => {
  test("median of odd and even counts, unsorted input", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNaN();
  });

  test("percentile is nearest rank", () => {
    const sorted = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(sorted, 95)).toBe(19);
    expect(percentile(sorted, 100)).toBe(20);
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile([], 50)).toBeNaN();
  });

  test("summarize", () => {
    expect(summarize([5, 1, 3])).toEqual({ n: 3, mean: 3, median: 3, p95: 5, min: 1, max: 5 });
  });
});
