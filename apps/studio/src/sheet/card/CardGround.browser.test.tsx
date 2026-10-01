/**
 * The ground glyph and the cut-plan stamp on the card (the pinned core): the glyph under the pin-side bottom
 * corner with the routed count in its four states, the cut facet's "cut ·", the count hiding below 40% zoom, the
 * node's measured size staying exactly C9's cardSize with both drawn, and the stamp that shows while the core is
 * selected with the card's index in the cut plan, the core first, or "Not cut".
 */
import { cardSize, contestedSelectors, type Hex4, type Project } from "@lattice-studio/core";
import { describe, expect, test } from "vitest";
import { getAnalysis, layoutMetrics, session } from "@/contracts";
import { fixtureCatalog, renderWithStudio } from "../../../test/harness";
import { planIndex, stampText } from "./plan-index";
import { CardSheet } from "./testing/CardSheet";
import { cardProject, GALLERY_FACETS } from "./testing/projects";

const SYMBOL: Hex4 = "0x95d89b41";
const catalog = fixtureCatalog();

function facetOf(name: string) {
  const facet = catalog.facets.find((f) => f.name === name);
  if (!facet) throw new Error(`${name} isn't in the fixture catalog.`);
  return facet;
}

function card(facet: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-facet="${facet}"]`);
  if (!el) throw new Error(`No card for ${facet}.`);
  return el;
}

function wrapper(facet: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${facet}"]`);
  if (!el) throw new Error(`No node for ${facet}.`);
  return el;
}

function glyph(facet: string): HTMLElement {
  const el = card(facet).querySelector<HTMLElement>("[data-ground]");
  if (!el) throw new Error(`${facet} has no ground glyph.`);
  return el;
}

function routedBy(facet: string): number {
  return Object.values(getAnalysis().routing).filter((route) => route.owner === facet).length;
}

async function sheet(project: Project, zoom = 1) {
  const screen = await renderWithStudio(<CardSheet zoom={zoom} />, { project });
  await expect.poll(() => document.querySelectorAll("[data-facet]").length).toBe(Object.keys(project.layout).length);
  return screen;
}

describe("the ground glyph", () => {
  test("hangs under the pin-side corner with the routed count, and the node keeps C9's size", async () => {
    const project = cardProject(catalog, GALLERY_FACETS, { exclude: [SYMBOL], pinsRight: ["GovernedVault"] });
    await sheet(project);
    const analysis = getAnalysis();
    for (const name of GALLERY_FACETS) {
      const routed = routedBy(name);
      const exported = facetOf(name).selectors.length;
      const g = glyph(name);
      expect([name, g.dataset.groundCount]).toEqual([name, routed === exported ? String(routed) : `${routed}/${exported}`]);
      expect([name, g.dataset.ground]).toEqual([name, routed === 0 ? "none" : routed === exported ? "routed" : "partial"]);
      expect(g.getAttribute("aria-hidden")).toBe("true");
      expect(getComputedStyle(g).pointerEvents).toBe("none");
      // The stem sits on the card's edge, 7 px into the 14 px mark, at the card's bottom.
      const box = g.getBoundingClientRect();
      const c = card(name).getBoundingClientRect();
      expect(Math.abs(box.top - c.bottom)).toBeLessThan(1);
      if (project.layout[name]?.pins === "right") expect(Math.abs(box.right - 7 - c.right)).toBeLessThan(1);
      else expect(Math.abs(box.left + 7 - c.left)).toBeLessThan(1);
      // Outside the card's box: React Flow measures the wrapper, and the wrapper is exactly C9's cardSize.
      const size = cardSize(facetOf(name), {
        metrics: layoutMetrics, expanded: project.layout[name]?.expanded === true, pins: project.layout[name]?.pins ?? "left",
        compact: false, contested: contestedSelectors(analysis, name),
      });
      expect([name, wrapper(name).offsetWidth, wrapper(name).offsetHeight]).toEqual([name, size.width, size.height]);
    }
    // The gallery covers every state: ERC20 routes some, Receive all, ERC20Pausable none (two seams elsewhere).
    expect(glyph("ERC20").dataset.ground).toBe("partial");
    expect(glyph("Receive").dataset.groundCount).toBe("1");
    expect(glyph("ERC20Pausable").dataset.ground).toBe("none");
    expect(glyph("ERC20Pausable").querySelectorAll("path")).toHaveLength(2);
  });

  test("the cut facet's glyph says cut; below 40% zoom the count hides and the mark stays", async () => {
    const project = cardProject(catalog, ["SafeDiamondCut", "ERC20"]);
    await sheet(project);
    expect(glyph("SafeDiamondCut").hasAttribute("data-cut")).toBe(true);
    expect(glyph("SafeDiamondCut").textContent).toBe(`cut · ${routedBy("SafeDiamondCut")}`);
    expect(glyph("ERC20").hasAttribute("data-cut")).toBe(false);
    session.set({ selection: ["ERC20"] });
    await expect.poll(() => glyph("ERC20").hasAttribute("data-live")).toBe(true);
    expect(glyph("SafeDiamondCut").hasAttribute("data-live")).toBe(false);
  });

  test("compact cards keep the mark and drop the count", async () => {
    await sheet(cardProject(catalog, ["ERC20"]), 0.35);
    await expect.poll(() => card("ERC20").dataset.compact).toBe("");
    expect(glyph("ERC20").querySelector("svg")).not.toBeNull();
    expect(glyph("ERC20").textContent).toBe("");
    expect(glyph("ERC20").dataset.groundCount).toBeDefined();
  });
});

describe("the cut-plan stamp", () => {
  test("shows while the core is selected: the card's index, the core first, or Not cut; the node keeps its size", async () => {
    const project = cardProject(catalog, GALLERY_FACETS, { exclude: [SYMBOL] });
    await sheet(project);
    expect(document.querySelector("[data-stamp]")).toBeNull();
    session.set({ selection: [], coreSelected: true });
    await expect.poll(() => document.querySelectorAll("[data-stamp]").length).toBe(GALLERY_FACETS.length);
    const plan = getAnalysis().plan;
    for (const name of GALLERY_FACETS) {
      const stamp = card(name).querySelector<HTMLElement>("[data-stamp]");
      expect([name, stamp?.textContent]).toEqual([name, stampText(planIndex(plan, name))]);
      const size = cardSize(facetOf(name), {
        metrics: layoutMetrics, expanded: false, pins: "left", compact: false, contested: contestedSelectors(getAnalysis(), name),
      });
      expect([name, wrapper(name).offsetWidth, wrapper(name).offsetHeight]).toEqual([name, size.width, size.height]);
      // Above the card's top-left corner.
      const box = stamp?.getBoundingClientRect();
      const c = card(name).getBoundingClientRect();
      expect(box && box.bottom <= c.top + 1 && Math.abs(box.left - c.left) < 1).toBe(true);
    }
    expect(card("ERC20Pausable").querySelector("[data-stamp]")?.textContent).toBe("Not cut");
    expect(card("ERC20Pausable").querySelector("[data-stamp]")?.hasAttribute("data-not-cut")).toBe(true);
    expect(card("Receive").querySelector("[data-stamp]")?.textContent).toMatch(/^\d\d$/);
    session.set({ coreSelected: false });
    await expect.poll(() => document.querySelectorAll("[data-stamp]").length).toBe(0);
  });
});
