/**
 * What floats over the sheet never piles onto what the sheet frames, in the real shell at the review's window
 * sizes: the empty sheet's Start block hangs from the top and ends above the core cell and the title block,
 * scrolling instead of running under them (SH-01); Fit, Zoom to selection and a loaded recipe's first view
 * frame the cards clear of the tool strip, the title block and the core cell (SH-02); the init order legend
 * ends above the title block (SH-03). The title block starts collapsed while the sheet is empty or short, and a
 * person's expand or collapse wins until that changes (David's decision on SH-01/SH-02).
 */
import { placeFacet, removeFacets, type Project, type Recipe } from "@lattice-studio/core";
import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { doc, runCommand, session } from "@/contracts";
import { Sheet } from "@/sheet/canvas/Sheet";
import { sheetViewport } from "@/sheet/canvas/sheet-view";
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
  // Whether the tour line shows without scrolling: at 1280 × 720 the 520 px sheet leaves the block about 330 px above
  // the core cell, whose empty-sheet hint makes it the taller of the two floats, so the tour line scrolls into view.
  test.each([
    [1440, 900, true],
    [1024, 800, true],
    [1280, 720, false],
    [1366, 768, true],
  ])("at %i × %i the Start block hangs from the top and nothing floats over it", async (width, height, tourShows) => {
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
    // The title block starts collapsed on the empty sheet (David's decision on SH-01/SH-02), so the block shows whole
    // down to the shortcut hint, and the tour line where it fits, clear of every float.
    await expect.poll(() => document.querySelector('[data-chrome="title-block"]')?.getAttribute("data-form")).toBe("collapsed");
    await expect.poll(() => {
      const clip = layer();
      const lines = [...document.querySelectorAll<HTMLElement>('[data-chrome="start"] section > p')].slice(-2, tourShows ? undefined : -1);
      if (!clip || lines.length === 0) return ["no hint lines"];
      return lines.flatMap((line) => {
        const r = line.getBoundingClientRect();
        const cut = r.top < clip.top || r.bottom > clip.bottom ? [`"${line.textContent}" cut by the layer`] : [];
        const under = floats().flatMap(([selector, float]) => (overlap(r, float) > 0 ? [`"${line.textContent}" under ${selector}`] : []));
        return [...cut, ...under];
      });
    }).toEqual([]);
    if (!tourShows) {
      const scroller = document.querySelector<HTMLElement>('[data-chrome="start"]');
      expect((scroller?.scrollHeight ?? 0) > (scroller?.clientHeight ?? 0)).toBe(true);
    }
  });
});

const form = () => document.querySelector('[data-chrome="title-block"]')?.getAttribute("data-form") ?? null;

describe("the title block's starting form (David's decision on SH-01/SH-02)", () => {
  test("collapsed while the sheet is empty, even on a tall sheet; full once a facet is placed", async () => {
    await page.viewport(1920, 1080);
    await renderWithStudio(<Shell />, { project: emptyProject("tb-empty"), settings: { reduceMotion: "on" } });
    await chromeDrawn();
    await expect.poll(form).toBe("collapsed");
    doc.apply("Placed", (p) => placeFacet(p, fixtureCatalog(), "ERC20", { x: 0, y: 0 }));
    await expect.poll(form).toBe("full");
    doc.apply("Removed", (p) => removeFacets(p, fixtureCatalog(), ["ERC20"]));
    await expect.poll(form).toBe("collapsed");
  });

  test("collapsed while the sheet is short (under 720 px), full on a tall one, following a resize", async () => {
    await page.viewport(1280, 720);
    await renderWithStudio(<Shell />, { project: sevenCards("tb-short"), settings: { reduceMotion: "on" } });
    await chromeDrawn();
    expect(box(".react-flow")?.height ?? 0).toBeLessThan(720);
    await expect.poll(form).toBe("collapsed");
    await page.viewport(1920, 1080);
    await expect.poll(() => box(".react-flow")?.height ?? 0).toBeGreaterThanOrEqual(720);
    await expect.poll(form).toBe("full");
    await page.viewport(1440, 900);
    await expect.poll(form).toBe("collapsed");
  });

  test("a short sheet's first view frames the cards in the room the collapsed block leaves", async () => {
    await page.viewport(1280, 720);
    await renderWithStudio(<Shell />, { project: sevenCards("tb-first-view"), settings: { reduceMotion: "on" } });
    await settled();
    await chromeDrawn();
    expect(form()).toBe("collapsed");
    const first = sheetViewport();
    await runCommand({ id: "sheet.zoomFit" }, "palette");
    const fit = await drawn();
    expect(Math.abs(first.zoom - fit.zoom)).toBeLessThan(1e-3);
    expect(Math.abs(first.x - fit.x)).toBeLessThan(0.5);
    expect(Math.abs(first.y - fit.y)).toBeLessThan(0.5);
  });

  test("a person's expand or collapse wins until the condition changes, and focus stays put when it does", async () => {
    await page.viewport(1280, 720);
    await renderWithStudio(<Shell />, { project: sevenCards("tb-choice"), settings: { reduceMotion: "on" } });
    await chromeDrawn();
    await expect.poll(form).toBe("collapsed");
    await page.getByRole("button", { name: "Expand title block" }).click();
    await expect.poll(form).toBe("full");
    // Re-renders and edits that leave the condition alone keep the choice.
    doc.apply("Placed", (p) => placeFacet(p, fixtureCatalog(), "Receive", { x: 0, y: 1600 }));
    session.set({ selection: ["Receive"] });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(form()).toBe("full");
    // The sheet grows tall (the default turns full), then short again: the default rules, not the old choice.
    await page.viewport(1920, 1080);
    await expect.poll(() => box(".react-flow")?.height ?? 0).toBeGreaterThanOrEqual(720);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(form()).toBe("full");
    await page.viewport(1280, 720);
    await expect.poll(form).toBe("collapsed");
    // Only a person's toggle takes focus to the new button; the default changing never does.
    expect(document.activeElement?.hasAttribute("data-title-toggle")).toBe(false);
    // Collapsing by hand on a tall sheet holds as well.
    await page.viewport(1920, 1080);
    await expect.poll(form).toBe("full");
    await page.getByRole("button", { name: "Collapse title block" }).click();
    await expect.poll(form).toBe("collapsed");
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(form()).toBe("collapsed");
  });

  test("on the empty sheet an expand holds until a facet is placed, and isn't brought back when it's removed", async () => {
    await page.viewport(1920, 1080);
    await renderWithStudio(<Shell />, { project: emptyProject("tb-empty-choice"), settings: { reduceMotion: "on" } });
    await chromeDrawn();
    await expect.poll(form).toBe("collapsed");
    await page.getByRole("button", { name: "Expand title block" }).click();
    await expect.poll(form).toBe("full");
    doc.apply("Placed", (p) => placeFacet(p, fixtureCatalog(), "ERC20", { x: 0, y: 0 }));
    await expect.poll(form).toBe("full");
    doc.apply("Removed", (p) => removeFacets(p, fixtureCatalog(), ["ERC20"]));
    await expect.poll(form).toBe("collapsed");
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
