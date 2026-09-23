/**
 * Build check (spec L822): Settings loads in its own chunk, opened on first use, not the entry (contracts
 * §6, this WP's Done-when). Builds the app with its own Vite config into a scratch directory, then reads
 * what the first load fetches (the entry script and its module preloads, from `index.html`) and what the
 * lazy chunks carry, the same way `apps/studio/src/chain/infra/entry-chunk.test.ts` does for the chain module.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { appDir } from "../../local-env";

/** A string only Settings → Keyboard's UI carries (its "Reset all shortcuts" button). */
const SETTINGS_MARKER = "Reset all shortcuts";

let firstLoad = "";
let lazy: string[] = [];

beforeAll(async () => {
  const out = mkdtempSync(join(tmpdir(), "studio-settings-chunk-"));
  try {
    await build({ configFile: join(appDir, "vite.config.ts"), logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
    const html = readFileSync(join(out, "index.html"), "utf8");
    const first = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1] ?? "");
    expect(first.length).toBeGreaterThan(0);
    firstLoad = first.map((path) => readFileSync(join(out, path), "utf8")).join("\n");
    lazy = readdirSync(join(out, "assets"))
      .filter((name) => name.endsWith(".js") && !first.includes(`assets/${name}`))
      .map((name) => readFileSync(join(out, "assets", name), "utf8"));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 120_000);

describe("Settings' chunk", () => {
  test("the entry chunk doesn't carry Settings' UI", () => {
    expect(firstLoad.includes(SETTINGS_MARKER)).toBe(false);
  });

  test("a lazy chunk does, so it's still reachable, just not at first paint", () => {
    expect(lazy.some((chunk) => chunk.includes(SETTINGS_MARKER))).toBe(true);
  });
});
