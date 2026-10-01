/**
 * PA L77: "Seam pins, the SEM-01 note, and the Move to… crosshair" has no board. Three small scenes, built from
 * the design system and the nearest drawn boards (the facet card, the collision note, and the sheet's tools).
 */
import { withCore } from "@lattice-studio/core";
import { beforeAll, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { CardSheet } from "@/sheet/card/testing/CardSheet";
import { cardProject, GALLERY_FACETS } from "@/sheet/card/testing/projects";
import { ensureElementVisible } from "@/sheet/canvas";
import { renderSheet } from "@/sheet/canvas/testing/sheet-harness";
import { cardNode, flowElement, focusedCard, press, renderInteractSheet, sheetProject } from "@/sheet/interact/testing/interact-harness";
import { session } from "@/contracts";
import { fixtureCatalog, renderWithStudio } from "../harness";

const catalog = fixtureCatalog();

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

function card(facet: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-facet="${facet}"]`);
  if (!el) throw new Error(`No card for ${facet}.`);
  return el;
}


describe.each(["dark", "light"] as const)("provisional: a seam pin on a facet card (%s)", (theme) => {
  test("ERC20's transfer stays on GovernedVault: locked, no route", async () => {
    const project = cardProject(catalog, GALLERY_FACETS, { exclude: ["0x95d89b41"] });
    await renderWithStudio(<CardSheet />, { theme, project, settings: { reduceMotion: "on" } });
    await expect.poll(() => document.querySelectorAll("[data-facet]").length).toBe(GALLERY_FACETS.length);
    const seam = card("ERC20").querySelector<HTMLElement>('[data-selector="0xa9059cbb"]');
    if (!seam) throw new Error("ERC20 draws no row for transfer.");
    await expect.poll(() => seam.dataset.state).toBe("seam");
    await document.fonts.ready;
    await expect.element(page.elementLocator(card("ERC20"))).toMatchScreenshot(`provisional-seam-pin-${theme}`);
  });
});

describe.each(["dark", "light"] as const)("provisional: the SEM-01 note (%s)", (theme) => {
  test("a stale owner: transfer must stay on a version that moves vote checkpoints with balances", async () => {
    const project = cardProject(catalog, ["ERC20", "ERC20Votes", "ERC20Pausable"], {
      columns: 2,
      owners: { "0xa9059cbb": "ERC20Pausable" },
    });
    await renderSheet({ theme, project, settings: { reduceMotion: "on" } });
    await expect.poll(() => document.querySelector('[data-note-kind="seam"]:not([data-leaving])'), { timeout: 8000 }).not.toBeNull();
    const note = document.querySelector<HTMLElement>('[data-note-kind="seam"]:not([data-leaving])');
    if (!note) throw new Error("No seam note.");
    ensureElementVisible(note);
    await expect.element(page.elementLocator(note)).toBeVisible();
    await expect.poll(() => {
      const a = note.getBoundingClientRect().top;
      return new Promise<boolean>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(note.getBoundingClientRect().top === a))));
    }).toBe(true);
    await document.fonts.ready;
    await expect.element(page.elementLocator(note)).toMatchScreenshot(`provisional-seam-note-${theme}`);
  });
});

describe("provisional: the Move to… crosshair (dark)", () => {
  test("M starts it; the crosshair and its ghost show over the sheet", async () => {
    const ID = "provisional-move-to";
    // The recipe carries the core, as every project does once parsed; the core is never a card.
    const cards = sheetProject(4, { id: ID });
    const project = { ...cards, recipe: withCore(cards.recipe, catalog) };
    await renderInteractSheet({ project, session: { viewports: { [ID]: { x: 60, y: 80, zoom: 1 } } } });
    const [a] = project.recipe.facets as [string];
    session.set({ selection: [a] });
    cardNode(a).focus();
    await expect.poll(focusedCard).toBe(a);
    press("m");
    await expect.poll(() => document.querySelector("[data-move-to]")).not.toBeNull();
    await document.fonts.ready;
    await expect.element(page.elementLocator(flowElement())).toMatchScreenshot("provisional-move-to-crosshair-dark");
  });
});
