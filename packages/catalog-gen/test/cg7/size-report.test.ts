import { describe, expect, test } from "bun:test";
import { gzipSync } from "node:zlib";
import { buildSizeReport, formatSizeReport, INDEX_GZIP_BUDGET_BYTES } from "../../src/size-report";

const encoder = new TextEncoder();

describe("buildSizeReport", () => {
  test("reports the index's exact byte length and gzip size", () => {
    const index = encoder.encode(JSON.stringify({ hello: "world" }));
    const report = buildSizeReport(index, []);
    expect(report.indexBytes).toBe(index.length);
    expect(report.indexGzipBytes).toBe(gzipSync(index).length);
    expect(report.budgetGzipBytes).toBe(INDEX_GZIP_BUDGET_BYTES);
  });

  test("is under budget when the gzip size is within the 60 KB target", () => {
    const index = encoder.encode(JSON.stringify({ tiny: true }));
    const report = buildSizeReport(index, []);
    expect(report.overBudget).toBe(false);
  });

  test("warns, without throwing, when the gzip size exceeds the budget", () => {
    const index = encoder.encode(JSON.stringify({ big: "x".repeat(200) }));
    const report = buildSizeReport(index, [], { budgetGzipBytes: 10 });
    expect(report.overBudget).toBe(true);
  });

  test("largestShards is sorted biggest first and capped at top", () => {
    const files = [
      { path: "a", bytes: 10 },
      { path: "b", bytes: 100 },
      { path: "c", bytes: 50 },
    ];
    const report = buildSizeReport(new Uint8Array(), files, { top: 2 });
    expect(report.largestShards).toEqual([
      { path: "b", bytes: 100 },
      { path: "c", bytes: 50 },
    ]);
  });

  test("an empty file list gives an empty largestShards", () => {
    const report = buildSizeReport(new Uint8Array(), []);
    expect(report.largestShards).toEqual([]);
  });
});

describe("formatSizeReport", () => {
  test("names every largest shard and says whether it's within budget", () => {
    const report = buildSizeReport(new Uint8Array(10), [{ path: "shards/ERC20.json", bytes: 5 }]);
    const text = formatSizeReport(report);
    expect(text).toContain("within the 60 KB gz target");
    expect(text).toContain("shards/ERC20.json: 5 B");
  });

  test("says so when over budget", () => {
    const report = buildSizeReport(new Uint8Array(10), [], { budgetGzipBytes: 1 });
    expect(formatSizeReport(report)).toContain("warning: over the 0 KB gz target");
  });
});
