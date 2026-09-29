/**
 * The font budget (spec L811, L826): exactly two self-hosted font files, ≤ 90 KB together. Reads the built
 * `dist/` directly, since that's what actually ships — the dev server this suite's other specs run against
 * doesn't bundle or hash fonts the way a production build does. Builds first when `dist/` is missing (the
 * brief's own Done-when commands run `bun run build` before `bun run e2e`, so this is normally a no-op); it
 * doesn't detect a stale build, only an absent one. Serial: both tests share that one build, and `beforeAll`
 * would otherwise run once per worker under `fullyParallel` and race to write the same `dist/`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { repoRoot } from "../../local-env.ts";

test.describe.configure({ mode: "serial" });

const distDir = join(repoRoot, "apps", "studio", "dist");
const assetsDir = join(distDir, "assets");
const FONT_BUDGET_BYTES = 90_000;
const FONT_COUNT = 2;

test.beforeAll(() => {
  if (existsSync(join(distDir, "index.html"))) return;
  // A production build, whatever the e2e run set: `VITE_STUDIO_E2E` would make this the e2e build (the config guard
  // refuses it), and it would then sit in `dist/` for every later size check.
  const result = spawnSync("bun", ["run", "build"], { cwd: repoRoot, stdio: "inherit", env: { ...process.env, VITE_STUDIO_E2E: "" } });
  if (result.status !== 0) throw new Error("`bun run build` failed; see the output above.");
});

test(`ships ${FONT_COUNT} font files totalling at most ${FONT_BUDGET_BYTES / 1000} KB`, () => {
  const fontFiles = readdirSync(assetsDir).filter((name) => name.endsWith(".woff2"));
  expect(fontFiles).toHaveLength(FONT_COUNT);

  const total = fontFiles.reduce((sum, name) => sum + statSync(join(assetsDir, name)).size, 0);
  expect(total).toBeLessThanOrEqual(FONT_BUDGET_BYTES);
});

test("preloads the Inter variable font as one of the built font files", () => {
  const html = existsSync(join(distDir, "index.html")) ? readFileSync(join(distDir, "index.html"), "utf8") : "";
  const preload = /<link\s+rel="preload"\s+as="font"[^>]*href="([^"]+)"/.exec(html);
  expect(preload, "index.html has no font preload link").not.toBeNull();

  const href = preload?.[1] ?? "";
  const basename = href.split("/").pop() ?? "";
  expect(basename.startsWith("inter-latin-wght-normal")).toBe(true);
  expect(existsSync(join(distDir, href.replace(/^\//, "")))).toBe(true);
});
