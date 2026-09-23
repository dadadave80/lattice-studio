/**
 * Build check (spec L822): Settings, the tour and the banner host each load in their own chunk, opened or
 * shown on first use, not the entry (contracts §6, this WP's Done-when). `App.tsx` mounts the tour and the
 * banner host (as `Toasts`) unconditionally, so without a state-gated `React.lazy` boundary their `@/ui`
 * imports (`Button`, `Banner`, and everything else the barrel re-exports) would ride along into the entry
 * even though both render nothing until there's something to show. Builds the app with its own Vite config
 * into a scratch directory, then reads what the first load fetches (the entry script and its module
 * preloads, from `index.html`) and what the lazy chunks carry, the same way
 * `apps/studio/src/chain/infra/entry-chunk.test.ts` does for the chain module.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { appDir } from "../../local-env";

/** A string only Settings → Keyboard's UI carries (its "Reset all shortcuts" button). */
const SETTINGS_MARKER = "Reset all shortcuts";
/** A string only the tour's UI carries (its first step's text). */
const TOUR_MARKER = "Drag a facet from here onto the sheet, or search by name.";
/** A prop name only `@/ui`'s `Banner` and this WP's `BannerHost` carry (not just the English word "banner"). */
const BANNER_MARKER = "onDismiss";

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

describe("Settings', the tour's and the banner host's chunks", () => {
  test("the entry chunk doesn't carry Settings' UI", () => {
    expect(firstLoad.includes(SETTINGS_MARKER)).toBe(false);
  });

  test("a lazy chunk does, so it's still reachable, just not at first paint", () => {
    expect(lazy.some((chunk) => chunk.includes(SETTINGS_MARKER))).toBe(true);
  });

  test("the entry chunk doesn't carry the tour's UI, even though App.tsx mounts it unconditionally", () => {
    expect(firstLoad.includes(TOUR_MARKER)).toBe(false);
  });

  test("a lazy chunk carries the tour's UI", () => {
    expect(lazy.some((chunk) => chunk.includes(TOUR_MARKER))).toBe(true);
  });

  test("the entry chunk doesn't carry the banner host's UI, even though App.tsx mounts it unconditionally", () => {
    expect(firstLoad.includes(BANNER_MARKER)).toBe(false);
  });

  test("a lazy chunk carries the banner host's UI", () => {
    expect(lazy.some((chunk) => chunk.includes(BANNER_MARKER))).toBe(true);
  });
});
