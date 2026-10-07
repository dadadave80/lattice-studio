/**
 * What floats over the sheet never piles onto what the sheet frames, in the real shell at the review's window
 * sizes: the empty sheet's Start block hangs from the top and ends above the core cell and the title block,
 * scrolling instead of running under them (SH-01); Fit, Zoom to selection and a loaded recipe's first view
 * frame the cards clear of the tool strip, the title block and the core cell (SH-02); the init order legend
 * ends above the title block (SH-03).
 */
import type { Project, Recipe } from "@lattice-studio/core";
import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { runCommand, session } from "@/contracts";
import { Sheet } from "@/sheet/canvas/Sheet";
import { drawn, emptyProject, settled } from "@/sheet/canvas/testing/sheet-harness";
import { cardProject } from "@/sheet/card/testing/projects";
import { Shell } from "@/shell";
import { fixtureCatalog, renderWithStudio } from "../../../test/harness";

afterEach(async () => {
  await page.viewport(1440, 900);
});

/** Px² two boxes share. */
function overlap(a: DOMRect, b: DOMRect): number {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
}

function box(selector: string): DOMRect | null {
  const el = document.querySelector<HTMLElement>(selector);
  return el && el.getClientRects().length > 0 ? el.getBoundingClientRect() : null;
}

/** The tool strip, the title block and the core cell, where they show. */
function floats(): [string, DOMRect][] {
  return ['[data-chrome="tool-strip"]', '[data-chrome="title-block"]', "[data-core-cell]"].flatMap((selector) => {
    const rect = box(selector);
    return rect ? [[selector, rect] as [string, DOMRect]] : [];
  });
}

/** What each card (or only `names`) shares with each float, named, so a failure says which. */
function cardsUnderFloats(names?: readonly string[]): string[] {
  const hits: string[] = [];
  for (const node of document.querySelectorAll<HTMLElement>(".react-flow__node")) {
    if (names && !names.includes(node.dataset.id ?? "")) continue;
    const rect = node.getBoundingClientRect();
    for (const [selector, float] of floats()) {
      const shared = overlap(rect, float);
      if (shared > 0) hits.push(`${node.dataset.id ?? "?"} under ${selector}: ${Math.round(shared)} px²`);
    }
  }
  return hits;
}

async function chromeDrawn(): Promise<void> {
  await expect.poll(() => box('[data-chrome="title-block"]') !== null, { timeout: 10_000 }).toBe(true);
  await expect.poll(() => box("[data-core-cell]") !== null, { timeout: 10_000 }).toBe(true);
  await expect.poll(() => box('[data-chrome="tool-strip"]') !== null, { timeout: 10_000 }).toBe(true);
}

describe("the empty sheet (SH-01)", () => {
  test.each([
    [1440, 900],
    [1024, 800],
    [1280, 720],
    [1366, 768],
  ])("at %i × %i the Start block hangs from the top and nothing floats over it", async (width, height) => {
    await page.viewport(width, height);
    await renderWithStudio(<Shell />, { project: emptyProject(`empty-${width}`), settings: { reduceMotion: "on" } });
    await chromeDrawn();
    const layer = () => box('[data-chrome="start"]');
    const block = () => box('[data-chrome="start"] section');
    await expect.poll(() => block() !== null).toBe(true);
    const sheet = box(".react-flow");
    if (!sheet) throw new Error("No sheet.");
    // Hung from the top (space-8), not centered on the sheet.
    await expect.poll(() => Math.round((block()?.top ?? 0) - sheet.top)).toBe(32);
    // What shows of the block (the layer clips it, and scrolls the rest) clears the title block and the cell.
    await expect.poll(() => {
      const shown = block();
      const clip = layer();
      if (!shown || !clip) return ["no block"];
      const visible = new DOMRect(shown.left, Math.max(shown.top, clip.top), shown.width, Math.max(0, Math.min(shown.bottom, clip.bottom) - Math.max(shown.top, clip.top)));
      return floats().flatMap(([selector, float]) => (overlap(visible, float) > 0 ? [`${selector}: ${Math.round(overlap(visible, float))} px²`] : []));
    }).toEqual([]);
  });
});

/** ERC20's recipe, roughly: seven cards in three columns, enough that Fit has to choose a zoom. */
function sevenCards(id: string): Project {
  const names = fixtureCatalog().facets.slice(0, 7).map((f) => f.name);
  return { ...cardProject(fixtureCatalog(), names, { columns: 3, rowPitch: 320 }), id };
}

describe("Fit and Zoom to selection frame clear of the floats (SH-02)", () => {
  test.each([
    [1440, 900],
    [1280, 720],
    [1024, 800],
  ])("at %i × %i", async (width, height) => {
    await page.viewport(width, height);
    const project = sevenCards(`fit-${width}`);
    await renderWithStudio(<Shell />, { project, settings: { reduceMotion: "on" } });
    await settled();
    await chromeDrawn();
    await runCommand({ id: "sheet.zoomFit" }, "palette");
    await drawn();
    await expect.poll(() => cardsUnderFloats()).toEqual([]);
    const name = Object.keys(project.layout)[4] ?? "";
    session.set({ selection: [name] });
    await runCommand({ id: "sheet.zoomSelection" }, "palette");
    await drawn();
    // The selection is framed clear of them; its neighbours, at 200%, may run under.
    await expect.poll(() => cardsUnderFloats([name])).toEqual([]);
  });

  test("a project with no stored viewport opens clear of them", async () => {
    await page.viewport(1280, 720);
    await renderWithStudio(<Shell />, { project: sevenCards("first-view"), settings: { reduceMotion: "on" } });
    await settled();
    await chromeDrawn();
    await expect.poll(() => cardsUnderFloats()).toEqual([]);
  });
});

const STEPS: Recipe["init"] = {
  kind: "steps",
  steps: [
    { spec: "ERC20Init", args: {} },
    { spec: "AccessControlInit", args: {} },
    { spec: "ERC4626Init", args: {} },
    { spec: "VaultCoreInit", args: {} },
  ],
};

describe("init order mode (SH-03)", () => {
  test("on a short sheet the legend ends above the title block, and scrolls", async () => {
    const project = cardProject(fixtureCatalog(), ["ERC20", "AccessControl", "ERC4626", "VaultCore", "Receive"], { columns: 3, rowPitch: 320 });
    await renderWithStudio(
      <div data-region="sheet" style={{ position: "relative", width: 1000, height: 460 }}>
        <Sheet />
      </div>,
      { project: { ...project, recipe: { ...project.recipe, init: STEPS } }, settings: { reduceMotion: "on" } },
    );
    await settled();
    await chromeDrawn();
    await runCommand({ id: "initOrder.toggle" }, "button");
    const legend = () => box('[data-chrome="init-legend"]');
    await expect.poll(() => legend() !== null).toBe(true);
    await expect.poll(() => {
      const title = box('[data-chrome="title-block"]');
      const shown = legend();
      return title && shown ? Math.round(title.top - shown.bottom) : null;
    }).toBeGreaterThanOrEqual(16);
    // Fit while it shows reserves its width: no card under the legend.
    await runCommand({ id: "sheet.zoomFit" }, "palette");
    await drawn();
    await expect.poll(() => {
      const shown = legend();
      if (!shown) return ["no legend"];
      return [...document.querySelectorAll<HTMLElement>(".react-flow__node")].flatMap((node) =>
        overlap(node.getBoundingClientRect(), shown) > 0 ? [node.dataset.id ?? "?"] : [],
      );
    }).toEqual([]);
  });
});
