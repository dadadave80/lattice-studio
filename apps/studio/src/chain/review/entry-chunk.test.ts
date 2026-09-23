/**
 * Build check (spec L822): the deploy review is its own lazy chunk. Builds the app with its own Vite config into a
 * scratch directory, then reads what the first load fetches (the entry script and its module preloads, from
 * `index.html`) and what the lazy chunks carry.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { appDir } from "../../../local-env";

/** Copy only the review renders: the hardware-wallet note, the no-simulation tick and the section titles. */
const REVIEW_MARKERS = ["Using a hardware wallet?", "Deploy without a simulation", "Authority after deploy"];
/** Copy only Remove facets renders. */
const REMOVE_MARKER = "Tick the facets to remove";
/** What the commands do when they run (command-runs.ts): loaded on the first run, never in the entry. */
const RUN_MARKERS = ["Drew a new salt", "The deploy review is already open.", "Nothing is live yet, so the salt stays as it is."];
/** The commands' own words stay in the entry: Deploy… must say why it's disabled before anything loads. */
const COMMAND_MARKERS = ["Deploy needs a connection", "Waiting for the Safe to execute the batch"];

let out = "";
let firstLoad = "";
let lazy: { name: string; text: string }[] = [];

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "studio-review-entry-"));
  await build({ configFile: join(appDir, "vite.config.ts"), logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
  const html = readFileSync(join(out, "index.html"), "utf8");
  const first = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1] ?? "");
  expect(first.length).toBeGreaterThan(0);
  firstLoad = first.map((path) => readFileSync(join(out, path), "utf8")).join("\n");
  lazy = readdirSync(join(out, "assets"))
    .filter((name) => name.endsWith(".js") && !first.includes(`assets/${name}`))
    .map((name) => ({ name, text: readFileSync(join(out, "assets", name), "utf8") }));
}, 180_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

describe("the deploy review's chunks (spec L822)", () => {
  test("the first load carries the commands' registrations but not the review, Remove facets or the runs", () => {
    for (const marker of [...REVIEW_MARKERS, REMOVE_MARKER, ...RUN_MARKERS]) expect({ marker, found: firstLoad.includes(marker) }).toEqual({ marker, found: false });
    for (const marker of COMMAND_MARKERS) expect({ marker, found: firstLoad.includes(marker) }).toEqual({ marker, found: true });
  });

  test("the review, Remove facets and the runs load together as S8b's one lazy chunk", () => {
    const chunk = lazy.find((c) => c.name.startsWith("lazy-"));
    expect(chunk).toBeDefined();
    for (const marker of [...REVIEW_MARKERS, REMOVE_MARKER, ...RUN_MARKERS]) {
      expect({ marker, found: chunk?.text.includes(marker) }).toEqual({ marker, found: true });
    }
  });
});
