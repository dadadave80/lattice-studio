/**
 * Board: `design/boards/current-init-order-mode.png` ("Init order mode", row 12). Provisional (orchestrator's
 * note, README): the init-order legend and path (`sheet/chrome/init-order-model.ts`, `InitOrderOverlay.tsx`,
 * the `initOrder.toggle` command) were built without a matching board, even though this board exists — it draws
 * the 11-card GovernedVault layout, which isn't reproduced here. Both themes, one with forced colors (the
 * board's dashed dependency path is a line).
 *
 * The project: a subset of GovernedVault's own facets (ERC20, AccessControl, ERC4626, VaultCore — verified
 * below against `loadTemplate`'s real facet list) and Receive, with a hand-authored `steps` init using the
 * facets' real InitSpecs, so the sheet dims, a dashed path and reorderable badges are all real, not fabricated.
 * (GovernedVault's own template init is a locked bundle, which cannot be dragged — see `SheetChrome.browser.
 * test.tsx`'s "a bundle shows its fixed order" test for that state instead.)
 */
import type { Recipe } from "@lattice-studio/core";
import { loadTemplate } from "@lattice-studio/core";
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { doc, runCommand, session } from "@/contracts";
import { emulateForcedColors } from "@/ui/testing/axe";
import { cardProject } from "@/sheet/card/testing/projects";
import { fixtureCatalog } from "../harness";
import { emptyProject, renderSheet, settled } from "@/sheet/canvas/testing/sheet-harness";

const SUBSET = ["ERC20", "AccessControl", "ERC4626", "VaultCore", "Receive"];

const STEPS: Recipe["init"] = {
  kind: "steps",
  steps: [
    { spec: "ERC20Init", args: {} },
    { spec: "AccessControlInit", args: {} },
    { spec: "ERC4626Init", args: {} },
    { spec: "VaultCoreInit", args: {} },
  ],
};

function stepsProject() {
  const catalog = fixtureCatalog();
  const template = loadTemplate(catalog, "GovernedVault");
  if (!template.ok) throw new Error(template.error);
  for (const name of SUBSET) {
    if (name === "Receive") continue;
    if (!template.value.facets.includes(name)) throw new Error(`${name} isn't a real GovernedVault facet.`);
  }
  const project = cardProject(catalog, SUBSET, { columns: 3, rowPitch: 320 });
  return { ...project, recipe: { ...project.recipe, init: STEPS } };
}

function card(facet: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(facet)}"] [data-facet]`);
  if (!el) throw new Error(`${facet} has no card.`);
  return el;
}

function badge(facet: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(facet)}"] [data-init-step]`);
}

async function initOrderOn(): Promise<void> {
  await runCommand({ id: "initOrder.toggle" }, "button");
  await expect.poll(() => session.get().modes.initOrder).toBe(true);
}

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

// Warms the sheet's lazy chunk (SheetCanvas, the chrome layers) before any timed test pays for it: an empty
// sheet's `settled()` resolves fast on its own, and unmounting leaves nothing behind for the first real render.
// `expect.poll` (inside `settled()`) only runs inside a test, so this warm-up is one.
test("(warm-up) loads the sheet's lazy chunk", async () => {
  const warm = await renderSheet({ project: emptyProject("warm") });
  await settled();
  await warm.unmount();
});

afterEach(async () => {
  await emulateForcedColors(false);
});

describe.each(["shop", "draft"] as const)("provisional: init order mode (%s)", (theme) => {
  // The first test in this file pays for the sheet's lazy chunk (SheetCanvas, the chrome layers) on top of
  // several polls, which can outrun the default 5 s test timeout on a cold cache.
  test("the sheet dims, a dashed path joins the steps, and the legend lists the order", { timeout: 15000 }, async () => {
    const project = stepsProject();
    await renderSheet({ project, theme, settings: { reduceMotion: "on" } });
    await settled();
    await initOrderOn();
    await expect.poll(() => badge("ERC20")?.textContent).toContain("01");
    expect(badge("VaultCore")?.textContent).toContain("04");
    expect(badge("Receive")).toBeNull();
    await expect.poll(() => getComputedStyle(card("Receive")).opacity).toBe("0.35");
    await expect.poll(() => document.querySelector("[data-init-path] polyline")).not.toBeNull();
    const legend = page.getByRole("region", { name: "Init order" });
    await expect.element(legend).toBeVisible();
    await expect.element(legend.getByText("Drag a badge to reorder")).toBeVisible();
    expect(doc.get().recipe.facets).toEqual(SUBSET);
    // The DEP-02 note ("needs ERC4626") settles into its final position a frame or two after the edges do;
    // wait until it holds still before shooting, or its label can land a pixel off between runs.
    const noteRect = () => document.querySelector('[role="note"]')?.getBoundingClientRect();
    await expect
      .poll(() => {
        const at = noteRect();
        return new Promise<boolean>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(JSON.stringify(noteRect()) === JSON.stringify(at)))),
          ),
        );
      })
      .toBe(true);
    await document.fonts.ready;
    await expect
      .element(page.elementLocator(document.querySelector('[data-region="sheet"]') as HTMLElement))
      .toMatchScreenshot(`provisional-init-order-mode-steps-${theme}`);
  });

  test("dragging a badge reorders the steps (the board's affordance the orchestrator asked for)", async () => {
    const project = stepsProject();
    await renderSheet({ project, theme, settings: { reduceMotion: "on" } });
    await settled();
    await initOrderOn();
    await userEvent.dragAndDrop(page.elementLocator(badge("ERC20") as HTMLElement), page.elementLocator(card("VaultCore")));
    await expect.poll(() => badge("ERC20")?.textContent).toContain("04");
  });
});

test("provisional: init order mode with forced colors (shop) — the dashed path stays legible", async () => {
  const project = stepsProject();
  await renderSheet({ project, theme: "shop", settings: { reduceMotion: "on" } });
  await settled();
  await initOrderOn();
  await emulateForcedColors(true);
  expect(matchMedia("(forced-colors: active)").matches).toBe(true);
  await expect.poll(() => document.querySelector("[data-init-path] polyline")).not.toBeNull();
  await document.fonts.ready;
  await expect
    .element(page.elementLocator(document.querySelector('[data-region="sheet"]') as HTMLElement))
    .toMatchScreenshot("provisional-init-order-mode-forced-shop");
});
