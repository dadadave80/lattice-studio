/**
 * Board: `design/boards/current-trace-and-cable.png` ("Trace and cable", row 03): dependency edges run foot to
 * foot; the overlap is a tie pin to pin. Trace/cable are the same edge (S4c's `TraceEdge`/`TieEdge`), themed:
 * dark draws the accent as a cable, light keeps it as ink. A conflict tie is the same `TieEdge` between two
 * contenders' pins for a contested selector.
 *
 * Provisional: forced-colors for traces and ties has no board (PA L82) — ties already carry a dash there
 * (Edges.module.css); this adds the trace.
 */
import { analyze, contestedSelectors, withCore, type Hex4, type Project } from "@lattice-studio/core";
import { makeRecipe } from "@lattice-studio/core/testing";
import { beforeAll, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { session } from "@/contracts";
import { cardProject } from "@/sheet/card/testing/projects";
import { renderSheet } from "@/sheet/canvas/testing/sheet-harness";
import { emulateForcedColors } from "@/ui/testing/axe";
import { fixtureCatalog } from "../harness";

const AXELAR = "AxelarGatewayAdapter";
const HYPERLANE = "HyperlaneGatewayAdapter";
const catalog = fixtureCatalog();

/**
 * VaultCore requires ERC4626 (a real "needs ERC4626" trace) but also overrides some of its selectors; picking
 * VaultCore as the owner up front keeps the scene to a clean trace. VaultCore alone also writes AccessControl's
 * namespace without it placed (DEP-02): placing AccessControl too keeps the scene down to just the trace, with
 * no convention note on top of it.
 */
function traceProject() {
  const facets = ["VaultCore", "ERC4626", "AccessControl"];
  const recipe = makeRecipe({ facets }, catalog);
  const contested = contestedSelectors(analyze(recipe, catalog), "VaultCore");
  const owners = Object.fromEntries(contested.map((hex: Hex4) => [hex, "VaultCore"]));
  return withCoreFacets(cardProject(catalog, facets, { columns: 3, owners }));
}

/** The recipe carries the core, as every project does once parsed; the core is never a card. */
function withCoreFacets(project: Project): Project {
  return { ...project, recipe: withCore(project.recipe, catalog) };
}

/** Waits until the title block's summary text (async on the analysis) has painted and holds still. */
async function settledScreen(): Promise<void> {
  await expect.element(page.getByText(/^\d+ facets? · \d+ selectors?$/)).toBeVisible();
  await expect.poll(() => {
    const text = document.querySelector("[data-inspector-plan], [data-region='title-block']")?.textContent ?? document.body.textContent;
    return new Promise<boolean>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(document.body.textContent === text))),
    );
  }).toBe(true);
}

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

/** The renderer only: nodes and edges, none of the chrome panels (toolbar, title block) beside them. */
function flow(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".react-flow__renderer");
  if (!el) throw new Error("The sheet isn't mounted.");
  return el;
}

describe.each(["dark", "light"] as const)("board: trace and cable, a dependency trace (%s)", (theme) => {
  test("VaultCore needs ERC4626: the trace, labelled, from provider to dependent", async () => {
    const project = traceProject();
    await renderSheet({ theme, project, settings: { reduceMotion: "on" } });
    await expect.poll(() => document.querySelector("g[data-edge='needs:VaultCore:ERC4626']"), { timeout: 8000 }).not.toBeNull();
    await expect.poll(() => document.querySelector("[data-trace-label='needs:VaultCore:ERC4626']")?.textContent).toBe("needs ERC4626");
    await settledScreen();
    await document.fonts.ready;
    await expect.element(page.elementLocator(flow())).toMatchScreenshot(`trace-and-cable-trace-${theme}`);
  });
});

describe.each(["dark", "light"] as const)("board: trace and cable, a conflict tie (%s)", (theme) => {
  test("Axelar and Hyperlane: two ties, pin to pin, between the contended selectors", async () => {
    const project = withCoreFacets(cardProject(catalog, [AXELAR, HYPERLANE], { columns: 2 }));
    await renderSheet({ theme, project, settings: { reduceMotion: "on" } });
    await expect.poll(() => document.querySelectorAll("path[data-edge^='tie:']").length, { timeout: 8000 }).toBe(2);
    await settledScreen();
    await document.fonts.ready;
    await expect.element(page.elementLocator(flow())).toMatchScreenshot(`trace-and-cable-conflict-${theme}`);
  });
});

describe("the trace paints in Chromium", () => {
  test("the svg holding a trace keeps its width (the reset's max-width: 100% clamped it to 0 px)", async () => {
    await renderSheet({ theme: "light", project: traceProject(), settings: { reduceMotion: "on" } });
    const edge = "g[data-edge='needs:VaultCore:ERC4626']";
    await expect.poll(() => document.querySelector(edge), { timeout: 8000 }).not.toBeNull();
    expect(document.querySelector(edge)?.closest("svg")?.getBoundingClientRect().width ?? 0).toBeGreaterThan(0);
  });

  test("the label sits over its own trace while an end is selected", async () => {
    await renderSheet({ theme: "light", project: traceProject(), settings: { reduceMotion: "on" } });
    const label = "[data-trace-label='needs:VaultCore:ERC4626']";
    await expect.poll(() => document.querySelector(label), { timeout: 8000 }).not.toBeNull();
    session.set({ selection: ["VaultCore"] });
    await expect.poll(() => document.querySelector(label)?.hasAttribute("data-live")).toBe(true);
    await settledScreen();
    // The label lets the pointer through; hit-test it as if it didn't, to see what paints on top.
    const onTop = () => {
      const el = document.querySelector<HTMLElement>(label);
      if (!el) return "no label";
      el.style.pointerEvents = "auto";
      const box = el.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return top?.closest(label) ? "label" : (top?.outerHTML.slice(0, 80) ?? "nothing");
    };
    await expect.poll(onTop).toBe("label");
  });
});

describe("provisional: forced colors on a trace (dark)", () => {
  test("a dependency trace keeps its 1.5 px ink in CanvasText under forced colors", async () => {
    const project = traceProject();
    await renderSheet({ theme: "dark", project, settings: { reduceMotion: "on" } });
    await expect.poll(() => document.querySelector("g[data-edge='needs:VaultCore:ERC4626']"), { timeout: 8000 }).not.toBeNull();
    await emulateForcedColors(true);
    try {
      await settledScreen();
      await document.fonts.ready;
      await expect.element(page.elementLocator(flow())).toMatchScreenshot("provisional-trace-forced-colors-dark");
    } finally {
      await emulateForcedColors(false);
    }
  });
});
