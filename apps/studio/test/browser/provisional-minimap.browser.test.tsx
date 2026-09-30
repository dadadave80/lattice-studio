/**
 * Former board: `design/boards/former-init-order-mode-and-the-minimap.png` (row 04, right side, "MINIMAP,
 * OPEN"). PA L67: the minimap is adopted, off by default; its own current board never got drawn (superseded by
 * the current empty/init-order boards, neither of which shows it), so this is provisional (orchestrator's
 * note). `sheet/canvas/Minimap.tsx`, toggled by `sheet.minimapToggle` (`sheet/canvas/commands.ts`); see
 * `Sheet.browser.test.tsx`'s "the minimap is off by default…" test for its behavior, exercised there, not here.
 *
 * A few facets placed (no init order mode), the minimap toggled open, both themes. The project is the real
 * ERC20 template (`loadTemplate`): a validated recipe with no selector collisions, so the sheet underneath the
 * minimap is quiet and the baseline is stable (an arbitrary facet list picks up real SEL-01 collisions, e.g.
 * two facets that both expose `name()`, whose default-owner tie-break isn't guaranteed stable pixel for pixel).
 */
import { isCoreFacet, loadTemplate } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { beforeAll, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { runCommand, settings } from "@/contracts";
import { emptyProject, renderSheet, settled } from "@/sheet/canvas/testing/sheet-harness";
import { fixtureCatalog } from "../harness";

function erc20Project() {
  const catalog = fixtureCatalog();
  const template = loadTemplate(catalog, "ERC20");
  if (!template.ok) throw new Error(template.error);
  const layout: Record<string, { x: number; y: number; pins: "left" | "right" }> = {};
  // Cards only: the core's two facets are in the recipe, never on the sheet.
  template.value.facets.filter((name) => !isCoreFacet(name)).forEach((name, i) => {
    layout[name] = { x: 24 + (i % 3) * 272, y: 24 + Math.floor(i / 3) * 320, pins: "left" };
  });
  return makeProject({ name: "ERC20", recipe: template.value, layout });
}

/** Two animation frames, so a screenshot taken right after a DOM change (the minimap's own lazy paint, here)
 * lands on a fully composited frame rather than one Chromium is still mid-paint on (a source of ~1% pixel
 * flakiness with nothing wrong in the DOM). */
async function settleFrame(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, 300));
}

function sheetElement(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-region="sheet"]');
  if (!el) throw new Error("No sheet.");
  return el;
}

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

// Warms the sheet's lazy chunk and the minimap's own lazy chunk before any timed test pays for either (see
// provisional-init-order-mode's note).
test("(warm-up) loads the sheet's and the minimap's lazy chunks", async () => {
  const warm = await renderSheet({ project: emptyProject("warm") });
  await settled();
  await runCommand({ id: "sheet.minimapToggle" }, "palette");
  await expect.element(page.getByRole("img", { name: "Minimap" })).toBeInTheDocument();
  await warm.unmount();
});

describe.each(["dark", "light"] as const)("provisional: the minimap, open (%s)", (theme) => {
  test("cards in ink, the view outlined in the accent, top-right above the sheet", { timeout: 15000 }, async () => {
    const project = erc20Project();
    await renderSheet({ project, theme, settings: { reduceMotion: "on" } });
    await settled();
    await runCommand({ id: "sheet.minimapToggle" }, "palette");
    expect(settings.get().minimap).toBe(true);
    await expect.poll(() => document.querySelectorAll(".react-flow__minimap-node").length).toBe(Object.keys(project.layout).length);
    await expect.element(page.getByRole("img", { name: "Minimap" })).toBeInTheDocument();
    await document.fonts.ready;
    await settleFrame();
    await expect.element(page.elementLocator(sheetElement())).toMatchScreenshot(`provisional-minimap-open-${theme}`);
  });
});
