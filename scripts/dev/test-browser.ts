#!/usr/bin/env bun
// Vitest Browser Mode for apps/studio. Accepts repo-relative paths (apps/studio/src/ui) or app-relative ones (src/ui).
import { existsSync, statfsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = join(import.meta.dir, "..", "..");
const app = join(root, "apps", "studio");
if (!existsSync(join(app, "vitest.config.ts"))) {
  console.error("Browser tests did not run: apps/studio/vitest.config.ts is missing.");
  process.exit(1);
}
// Diagnostic control: collect after about 4 GiB of additional native scratch accumulates.
if (process.env.STUDIO_BROWSER_DIAGNOSTICS_DIR) {
  try {
    const stats = statfsSync(tmpdir());
    const available = stats.bavail * stats.bsize;
    if (stats.bavail >= 0 && stats.bsize > 0 && Number.isFinite(available))
      process.env.VITEST_CHROMIUM_GC_DISK_THRESHOLD_GB = String(Math.max(4, available / 1024 ** 3 - 4));
  } catch { /* Keep Vitest's existing threshold when measurement is unavailable. */ }
}
const filters = process.argv.slice(2).map((a) => a.replace(/^\.?\/?apps\/studio\//, ""));
const p = Bun.spawnSync(["bun", "x", "vitest", "run", ...filters], { cwd: app, stdout: "inherit", stderr: "inherit", env: process.env });
process.exit(p.exitCode ?? 1);
