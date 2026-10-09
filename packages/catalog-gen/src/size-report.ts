/**
 * Size reporting for a written catalog (spec L812): the index's gzip size against the 60 KB target, and the
 * largest shards. Warn-only — nothing here fails the build; `bun run catalog` (WP-CG8) decides what to do
 * with the report.
 */
import { gzipSync } from "node:zlib";

/**
 * The spec's target (spec L812): "Catalog index ≤ 60 KB gz (target)". Not met, and accepted (Q15): with the index
 * minified and recipes and init docs moved to their own files, dev-f4a32c8's index measures 73,930 B gz (72.2 KB,
 * down from 81,407 B). What's left is about 186 shared contracts' release data (salts, addresses, hashes), which
 * stays in the index, so the report keeps warning.
 */
export const INDEX_GZIP_BUDGET_BYTES = 60 * 1024;

/** One file's size, for the largest-shards list. */
export type FileSize = { path: string; bytes: number };

export type SizeReport = {
  indexBytes: number;
  indexGzipBytes: number;
  budgetGzipBytes: number;
  /** `indexGzipBytes > budgetGzipBytes`: a warning, not a failure. */
  overBudget: boolean;
  /** The largest files among `files`, biggest first. */
  largestShards: FileSize[];
};

/**
 * Builds the report from the written `index.json` bytes and every other written file's size. `top` (default 10)
 * caps how many files `largestShards` lists; `budgetGzipBytes` overrides the 60 KB target for testing.
 */
export function buildSizeReport(
  indexBytes: Uint8Array,
  files: readonly FileSize[],
  opts?: { top?: number; budgetGzipBytes?: number },
): SizeReport {
  const budgetGzipBytes = opts?.budgetGzipBytes ?? INDEX_GZIP_BUDGET_BYTES;
  const top = opts?.top ?? 10;
  const indexGzipBytes = gzipSync(indexBytes).length;
  const largestShards = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, top);
  return {
    indexBytes: indexBytes.length,
    indexGzipBytes,
    budgetGzipBytes,
    overBudget: indexGzipBytes > budgetGzipBytes,
    largestShards,
  };
}

/** A human-readable summary for `bun run catalog`'s console output. */
export function formatSizeReport(report: SizeReport): string {
  const budgetKb = (report.budgetGzipBytes / 1024).toFixed(0);
  const gzipKb = (report.indexGzipBytes / 1024).toFixed(1);
  const status = report.overBudget ? `warning: over the ${budgetKb} KB gz target` : `within the ${budgetKb} KB gz target`;
  const lines = [
    `Catalog index: ${report.indexBytes} B (${gzipKb} KB gz) — ${status}`,
    "Largest shards:",
    ...report.largestShards.map((shard) => `  ${shard.path}: ${shard.bytes} B`),
  ];
  return lines.join("\n");
}
