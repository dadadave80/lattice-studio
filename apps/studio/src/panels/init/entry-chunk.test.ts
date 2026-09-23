/**
 * Build check (spec L822): the init forms and Choose an upgrade mechanism are their own chunks. Builds the app with
 * its own Vite config into a scratch directory, then reads what the first load fetches (the entry script and its
 * module preloads, from `index.html`) and what the lazy chunks carry.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { appDir } from "../../../local-env";

/**
 * Strings only the editor (InitEditor's step list label) and only the dialog (the delay's help) contain. Not spec
 * copy: the spec's own labels, such as "Register ERC-165 interfaces (automatic)", are shown by other surfaces
 * too (the Structure tree's automatic step), so they can't tell the editor's chunk apart.
 */
const EDITOR_MARKER = "Steps in call order";
const DIALOG_MARKER = "How long a scheduled cut waits before it can run.";

let out = "";
let firstLoad = "";
let lazy: { name: string; text: string }[] = [];

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "studio-init-entry-"));
  await build({ configFile: join(appDir, "vite.config.ts"), logLevel: "silent", build: { outDir: out, emptyOutDir: true } });
  const html = readFileSync(join(out, "index.html"), "utf8");
  const first = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1] ?? "");
  expect(first.length).toBeGreaterThan(0);
  firstLoad = first.map((path) => readFileSync(join(out, path), "utf8")).join("\n");
  lazy = readdirSync(join(out, "assets"))
    .filter((name) => name.endsWith(".js") && !first.includes(`assets/${name}`))
    .map((name) => ({ name, text: readFileSync(join(out, "assets", name), "utf8") }));
}, 120_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

describe("the init editor's chunks (spec L822)", () => {
  test("the first load carries neither the editor nor the dialog", () => {
    expect(firstLoad.includes(EDITOR_MARKER)).toBe(false);
    expect(firstLoad.includes(DIALOG_MARKER)).toBe(false);
  });

  test("the editor and the dialog each load as their own lazy chunk", () => {
    const editor = lazy.find((chunk) => chunk.name.startsWith("InitEditor-"));
    const dialog = lazy.find((chunk) => chunk.name.startsWith("ChooseMechanismDialog-"));
    expect(editor?.text.includes(EDITOR_MARKER)).toBe(true);
    expect(dialog?.text.includes(DIALOG_MARKER)).toBe(true);
  });
});
