/**
 * Auto-pan keeps a focused card clear of everything that floats over the sheet (spec L771, 2.4.11): here the
 * minimap, the console, a toast that's showing, and an open drawer at 1024-1279 px, each on its own.
 */
import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { doc, runCommand, session } from "@/contracts";
import { Shell } from "@/shell";
import { createToasts, ToastRegion } from "@/ui/overlays";
import { fixtureCatalog, onCleanup, renderWithStudio } from "../../../test/harness";
import { cardProject } from "../card/testing/projects";
import { Sheet } from "./Sheet";
import { ensureVisible } from "./sheet-view";
import { cardScreenRect, drawn, flowElement, renderSheet, settled } from "./testing/sheet-harness";

const CARD = "Receive";

afterEach(async () => {
  await page.viewport(1440, 900);
});

function project() {
  return cardProject(fixtureCatalog(), [CARD]);
}

/** An element's rect relative to the sheet's top-left corner. */
function onSheet(el: Element): DOMRect {
  const sheet = flowElement().getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return new DOMRect(r.left - sheet.left, r.top - sheet.top, r.width, r.height);
}

function overlapArea(a: DOMRect, b: DOMRect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Moves the view (at 100%) so the card's top-left corner sits 12 px inside the float's top-left corner. */
async function putCardUnder(float: DOMRect): Promise<void> {
  const entry = doc.get().layout[CARD];
  if (!entry) throw new Error(`${CARD} isn't placed.`);
  const id = doc.get().id;
  const x = float.x + 12;
  const y = float.y + 12;
  session.set((s) => ({ viewports: { ...s.viewports, [id]: { x: x - entry.x, y: y - entry.y, zoom: 1 } } }));
  await expect.poll(() => Math.round(cardScreenRect(CARD).x)).toBe(Math.round(x));
  expect(overlapArea(cardScreenRect(CARD), float)).toBeGreaterThan(0);
}

/** Puts the card under `float`, runs auto-pan, and expects the card clear of it and inside the sheet. */
async function clearsOf(float: Element): Promise<void> {
  await putCardUnder(onSheet(float));
  expect(ensureVisible(CARD)).toBe(true);
  await drawn();
  await expect.poll(() => overlapArea(cardScreenRect(CARD), onSheet(float))).toBe(0);
  const sheet = flowElement().getBoundingClientRect();
  const card = cardScreenRect(CARD);
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.y).toBeGreaterThanOrEqual(0);
  expect(card.right).toBeLessThanOrEqual(sheet.width);
  expect(card.bottom).toBeLessThanOrEqual(sheet.height);
}

describe("auto-pan clears what floats over the sheet (spec L771)", () => {
  test("the minimap", async () => {
    await renderSheet({ project: project(), settings: { minimap: true, reduceMotion: "on" } });
    await expect.poll(() => document.querySelector(".react-flow__minimap")).not.toBeNull();
    const minimap = document.querySelector(".react-flow__minimap");
    if (!minimap) throw new Error("no minimap");
    await clearsOf(minimap);
  });

  test("the console, where it covers the sheet", async () => {
    await renderSheet({ project: project() });
    const console = document.createElement("section");
    console.dataset.region = "console";
    Object.assign(console.style, { position: "fixed", left: "0", top: "440px", width: "620px", height: "200px" });
    document.body.append(console);
    onCleanup(() => console.remove());
    await clearsOf(console);
  });

  test("a toast that's showing", async () => {
    // The toast is fixed to the window's bottom-right corner. The sheet runs on past the window's right edge, so
    // the toast sits over the middle of it, away from the title block (bottom-right of the sheet), which would
    // otherwise push the card clear of the toast by itself.
    await page.viewport(1000, 700);
    const toasts = createToasts();
    await renderWithStudio(
      <>
        <div data-region="sheet" style={{ position: "fixed", left: 0, top: 0, width: 2400, height: 700 }}>
          <Sheet />
        </div>
        <ToastRegion manager={toasts.manager} />
      </>,
      { project: project(), settings: { reduceMotion: "on" } },
    );
    await settled();
    toasts.add({ text: "Removed 2 facets", action: { id: "history.undo" } });
    await expect.poll(() => document.querySelector('[data-region="toasts"] > *')).not.toBeNull();
    const toast = document.querySelector('[data-region="toasts"] > *');
    if (!toast) throw new Error("no toast");
    expect(overlapArea(onSheet(toast), new DOMRect(0, 0, 2400, 700))).toBeGreaterThan(0);
    // Nothing else floats where the toast is.
    for (const panel of document.querySelectorAll(".react-flow__panel")) expect(overlapArea(onSheet(panel), onSheet(toast))).toBe(0);
    await clearsOf(toast);
  });

  test("an open drawer at 1024-1279 px", async () => {
    await page.viewport(1200, 800);
    await renderWithStudio(<Shell />, { project: project(), settings: { reduceMotion: "on" } });
    await settled();
    await runCommand({ id: "pane.show", args: { pane: "inspector" } }, "palette");
    const drawer = document.querySelector<HTMLElement>('[data-region="inspector"]');
    if (!drawer) throw new Error("no inspector region");
    await expect.poll(() => !drawer.hidden && drawer.getClientRects().length > 0).toBe(true);
    // The drawer lies over the sheet rather than beside it.
    const sheet = flowElement().getBoundingClientRect();
    await expect.poll(() => overlapArea(onSheet(drawer), new DOMRect(0, 0, sheet.width, sheet.height))).toBeGreaterThan(0);
    await clearsOf(drawer);
  });
});
