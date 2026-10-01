/**
 * Screenshot baselines for the pinned core, in Dark and Light and with forced colors: the core cell at rest,
 * selected, on an empty sheet, collapsed and in conflict (two cut facets); the ground glyphs in their four states
 * (every export routed, some, none, the cut facet), with pins on either side; and the cut-plan stamps while the
 * core is selected. The cell shots frame the cell alone; the glyph and stamp shots frame the sheet.
 */
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { session } from "@/contracts";
import { emulateForcedColors } from "@/ui/testing/axe";
import { paneElement, renderSheet } from "../canvas/testing/sheet-harness";
import { cell, coreProject } from "./testing/core-harness";

const RECEIVE = "0x00000000";
const SYMBOL = "0x95d89b41";
/**
 * Every glyph state: ERC20 routes some (its symbol is left out), Pausable routes all, SafeDiamondCut is the cut
 * (pins on the right), Receive routes nothing (its one selector left out). No two collide, so no note shows.
 */
const GLYPHS = ["ERC20", "Pausable", "SafeDiamondCut", "Receive"];
/** The first column clears the tool strip. */
const COLUMN_OFFSET = 72;

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

afterEach(async () => {
  await emulateForcedColors(false);
});

function sheetElement(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-region="sheet"]');
  if (!el) throw new Error("No sheet.");
  return el;
}

/** The sheet with the core cell drawn beside the title block, its position settled, and the pointer parked on empty sheet. */
async function renderCore(project: ReturnType<typeof coreProject>, theme: "dark" | "light") {
  await renderSheet({ project, theme, session: { viewports: { [project.id]: { x: 0, y: 0, zoom: 1 } } } });
  await expect.poll(() => document.querySelector("[data-core-cell]"), { timeout: 10_000 }).not.toBeNull();
  await expect
    .poll(() => {
      const title = document.querySelector('[data-chrome="title-block"]');
      return title ? Math.abs(cell().getBoundingClientRect().right + 8 - title.getBoundingClientRect().left) < 2 : false;
    })
    .toBe(true);
  await userEvent.hover(paneElement(), { position: { x: 300, y: 690 } });
  await document.fonts.ready;
}

function glyphProject(id: string) {
  const project = coreProject(GLYPHS, { id, columns: 3, rowPitch: 392, pinsRight: ["SafeDiamondCut"], exclude: [SYMBOL, RECEIVE] });
  const layout: typeof project.layout = {};
  for (const [name, entry] of Object.entries(project.layout)) layout[name] = { ...entry, x: entry.x + COLUMN_OFFSET };
  return { ...project, layout };
}

async function selectCore(): Promise<void> {
  session.set({ selection: [], coreSelected: true });
  await expect.poll(() => cell().hasAttribute("data-selected")).toBe(true);
  await expect.poll(() => document.querySelectorAll("[data-stamp]").length).toBeGreaterThan(0);
}

describe.each(["dark", "light"] as const)("%s", (theme) => {
  test("the cell at rest", async () => {
    await renderCore(coreProject(["ERC20", "SafeDiamondCut"], { id: "screens-rest" }), theme);
    await expect.element(page.elementLocator(cell())).toMatchScreenshot(`cell-rest-${theme}`);
  });

  test("the cell selected", async () => {
    await renderCore(coreProject(["ERC20", "SafeDiamondCut"], { id: "screens-selected" }), theme);
    await selectCore();
    await expect.element(page.elementLocator(cell())).toMatchScreenshot(`cell-selected-${theme}`);
  });

  test("the cell on an empty sheet, with its hint", async () => {
    await renderCore(coreProject([], { id: "screens-empty" }), theme);
    await expect.element(page.elementLocator(cell())).toMatchScreenshot(`cell-empty-${theme}`);
  });

  test("the cell collapsed", async () => {
    await renderCore(coreProject(["ERC20", "SafeDiamondCut"], { id: "screens-collapsed" }), theme);
    session.set((s) => ({ panes: { ...s.panes, core: { collapsed: true } } }));
    await expect.poll(() => cell().hasAttribute("data-collapsed")).toBe(true);
    await expect.element(page.elementLocator(cell())).toMatchScreenshot(`cell-collapsed-${theme}`);
  });

  test("the cell in conflict: two cut facets", async () => {
    await renderCore(coreProject(["SafeDiamondCut", "GovernedDiamondCut"], { id: "screens-conflict" }), theme);
    await expect.element(page.elementLocator(cell())).toMatchScreenshot(`cell-conflict-${theme}`);
  });

  test("the glyphs: routed, partial, none and the cut, on either pin side", async () => {
    await renderCore(glyphProject("screens-glyphs"), theme);
    expect(document.querySelectorAll("[data-ground]")).toHaveLength(GLYPHS.length);
    await expect.element(page.elementLocator(sheetElement())).toMatchScreenshot(`glyphs-${theme}`);
  });

  test("the stamps while the core is selected", async () => {
    await renderCore(glyphProject("screens-stamps"), theme);
    await selectCore();
    await expect.element(page.elementLocator(sheetElement())).toMatchScreenshot(`stamps-${theme}`);
  });

  test("forced colors: the cell at rest", async () => {
    await renderCore(coreProject(["ERC20", "SafeDiamondCut"], { id: "screens-forced" }), theme);
    await emulateForcedColors(true);
    expect(matchMedia("(forced-colors: active)").matches).toBe(true);
    await expect.element(page.elementLocator(cell())).toMatchScreenshot(`cell-rest-forced-${theme}`);
  });

  test("forced colors: the cell selected", async () => {
    await renderCore(coreProject(["ERC20", "SafeDiamondCut"], { id: "screens-forced-selected" }), theme);
    await emulateForcedColors(true);
    await selectCore();
    await expect.element(page.elementLocator(cell())).toMatchScreenshot(`cell-selected-forced-${theme}`);
  });

  test("forced colors: the glyphs", async () => {
    await renderCore(glyphProject("screens-forced-glyphs"), theme);
    await emulateForcedColors(true);
    await expect.element(page.elementLocator(sheetElement())).toMatchScreenshot(`glyphs-forced-${theme}`);
  });

  test("forced colors: the stamps", async () => {
    await renderCore(glyphProject("screens-forced-stamps"), theme);
    await emulateForcedColors(true);
    await selectCore();
    await expect.element(page.elementLocator(sheetElement())).toMatchScreenshot(`stamps-forced-${theme}`);
  });
});
