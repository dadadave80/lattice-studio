#!/usr/bin/env bun
// Playwright for apps/studio. Accepts repo-relative paths (apps/studio/e2e/q1a) or app-relative ones (e2e/q1a).
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const app = join(root, "apps", "studio");
if (!existsSync(join(app, "playwright.config.ts"))) { console.log("Not built yet · WP-K2 (apps/studio/playwright.config.ts)"); process.exit(0); }
const args = process.argv.slice(2).map((a) => a.replace(/^\.?\/?apps\/studio\//, ""));
const p = Bun.spawnSync(["bun", "x", "playwright", "test", ...args], { cwd: app, stdout: "inherit", stderr: "inherit", env: process.env });
process.exit(p.exitCode ?? 1);
