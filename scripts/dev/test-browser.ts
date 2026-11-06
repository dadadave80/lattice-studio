#!/usr/bin/env bun
// Vitest Browser Mode for apps/studio. Accepts repo-relative paths (apps/studio/src/ui) or app-relative ones (src/ui).
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const app = join(root, "apps", "studio");
if (!existsSync(join(app, "vitest.config.ts"))) {
  console.error("Browser tests did not run: apps/studio/vitest.config.ts is missing.");
  process.exit(1);
}
// Diagnostic control: exercise Vitest's native collection after each file.
if (process.env.STUDIO_BROWSER_DIAGNOSTICS_DIR) process.env.VITEST_CHROMIUM_GC_DISK_THRESHOLD_GB = "1024";
const filters = process.argv.slice(2).map((a) => a.replace(/^\.?\/?apps\/studio\//, ""));
const p = Bun.spawnSync(["bun", "x", "vitest", "run", ...filters], { cwd: app, stdout: "inherit", stderr: "inherit", env: process.env });
process.exit(p.exitCode ?? 1);
