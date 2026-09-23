#!/usr/bin/env bun
// Vitest Browser Mode for apps/studio. Accepts repo-relative paths (apps/studio/src/ui) or app-relative ones (src/ui).
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const app = join(root, "apps", "studio");
if (!existsSync(join(app, "vitest.config.ts"))) { console.log("Not built yet · WP-K2 (apps/studio/vitest.config.ts)"); process.exit(0); }
const filters = process.argv.slice(2).map((a) => a.replace(/^\.?\/?apps\/studio\//, ""));
const p = Bun.spawnSync(["bun", "x", "vitest", "run", "--passWithNoTests", ...filters], { cwd: app, stdout: "inherit", stderr: "inherit", env: process.env });
process.exit(p.exitCode ?? 1);
