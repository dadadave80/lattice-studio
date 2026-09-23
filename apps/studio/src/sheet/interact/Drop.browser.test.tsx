/**
 * The sheet as the catalog's drop target (Flow 3 step 1, IR L55): a snapped ghost with "x · y" while a row is
 * dragged over it, placing there on release (the nearest free slot when that's taken), cancelled when released
 * anywhere else. And touch (IR L57): one finger draws the marquee with the Select tool without panning.
 */
import { describe, expect, test } from "vitest";
import { doc, startCatalogDrag } from "@/contracts";
import { fixtureCatalog } from "../../../test/harness";
import { cardNode, client, drawnViewport, paneElement, renderInteractSheet, selection, sheetProject } from "./testing/interact-harness";

const ID = "drop";
const VIEW = { session: { viewports: { [ID]: { x: 60, y: 80, zoom: 1 } } } };

async function sheet(count = 2) {
  const project = sheetProject(count, { id: ID });
  await renderInteractSheet({ project, ...VIEW });
  const unplaced = fixtureCatalog().facets.map((f) => f.name).find((name) => !project.recipe.facets.includes(name));
  if (!unplaced) throw new Error("Every fixture facet is placed.");
  return { placed: project.recipe.facets as [string, string], facet: unplaced };
}

function pointer(type: "pointermove" | "pointerup", at: { clientX: number; clientY: number }): void {
  window.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 11, pointerType: "mouse", isPrimary: true, ...at }));
}

function ghost(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-drop-ghost]");
}

describe("dropping a catalog row", () => {
  test("a snapped ghost shows where it lands, with x · y; releasing places it there", async () => {
    const { facet } = await sheet();
    startCatalogDrag(facet, { pointerId: 11, ...client({ x: -100, y: 300 }) });
    // (600, 500) on screen is (540, 420) on the sheet; the pointer holds the card by its header's middle.
    pointer("pointermove", client({ x: 600, y: 500 }));
    await expect.poll(() => ghost()?.textContent).toBe("424 · 400");
    expect(ghost()?.dataset.dropGhost).toBe(facet);
    pointer("pointerup", client({ x: 600, y: 500 }));
    await expect.poll(() => doc.get().layout[facet]).toMatchObject({ x: 424, y: 400 });
    expect(ghost()).toBeNull();
    expect(selection()).toEqual([facet]);
    expect(doc.state().undoLabel).toMatch(new RegExp(`^Placed ${facet}`));
  });

  test("released anywhere else, it cancels", async () => {
    const { facet } = await sheet();
    startCatalogDrag(facet, { pointerId: 11, ...client({ x: -100, y: 300 }) });
    pointer("pointermove", client({ x: 600, y: 500 }));
    await expect.poll(() => ghost()).not.toBeNull();
    pointer("pointermove", client({ x: 1200, y: 500 }));
    await expect.poll(() => ghost()).toBeNull();
    pointer("pointerup", client({ x: 1200, y: 500 }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(doc.get().layout[facet]).toBeUndefined();
  });

  test("dropped onto a card, it goes to the nearest free slot", async () => {
    const { facet, placed } = await sheet();
    const [a] = placed;
    startCatalogDrag(facet, { pointerId: 11, ...client({ x: -100, y: 300 }) });
    pointer("pointermove", client({ x: 150, y: 120 }));
    pointer("pointerup", client({ x: 150, y: 120 }));
    await expect.poll(() => doc.get().layout[facet]).toBeDefined();
    await expect.poll(() => {
      const r = cardNode(facet).getBoundingClientRect();
      const o = cardNode(a).getBoundingClientRect();
      return r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top;
    }).toBe(false);
  });

  test("the tour's target for where a facet goes is on the sheet", async () => {
    await sheet();
    expect(document.querySelector('[data-region="sheet"] [data-tour="place-facet"]')).not.toBeNull();
  });
});

describe("touch", () => {
  test("one finger on empty sheet draws the marquee and doesn't pan", async () => {
    const { placed } = await sheet(2);
    const [a] = placed;
    const before = drawnViewport();
    const pane = paneElement();
    const base = { bubbles: true, cancelable: true, view: window, pointerId: 21, pointerType: "touch", isPrimary: true, button: 0 };
    const at = (x: number, y: number) => client({ x, y });
    const touch = (type: string, x: number, y: number) => {
      const point = new Touch({ identifier: 21, target: pane, ...at(x, y) });
      pane.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [point], changedTouches: [point], targetTouches: type === "touchend" ? [] : [point],
      }));
    };
    pane.dispatchEvent(new PointerEvent("pointerdown", { ...base, buttons: 1, ...at(40, 600) }));
    touch("touchstart", 40, 600);
    for (const [x, y] of [[80, 450], [110, 300], [120, 150]] as const) {
      pane.dispatchEvent(new PointerEvent("pointermove", { ...base, buttons: 1, ...at(x, y) }));
      touch("touchmove", x, y);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    pane.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0, ...at(120, 150) }));
    touch("touchend", 120, 150);
    expect(selection()).toEqual([a]);
    expect(drawnViewport()).toEqual(before);
  });
});
