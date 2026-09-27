/**
 * The sheet as the catalog's drop target (Flow 3 step 1, IR L55): a snapped ghost with "x · y" while a row is
 * dragged over it, placing there on release (the nearest free slot when that's taken), cancelled when released
 * anywhere else. And touch (IR L57): one finger draws the marquee with the Select tool without panning.
 */
import { describe, expect, test } from "vitest";
import { doc, startCatalogDrag } from "@/contracts";
import { fixtureCatalog } from "../../../test/harness";
import { cardNode, client, drawnViewport, paneElement, renderInteractSheet, selection, sheetProject, touchScreen } from "./testing/interact-harness";

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

/*
 * d3-zoom (React Flow's panning) and d3-drag (dragging) listen for touches only where the browser has them;
 * `touchScreen()` says this desktop test browser does, so a gesture the marquee or a card drag doesn't take
 * would really pan or zoom.
 */
describe("touch", () => {
  test("one finger on empty sheet draws the marquee and doesn't pan", async () => {
    touchScreen();
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

describe("pinch", () => {
  test("two fingers from empty sheet zoom, even though one finger there draws the marquee", async () => {
    touchScreen();
    await sheet(2);
    const pane = paneElement();
    const before = drawnViewport();
    const at = (x: number, y: number) => client({ x, y });
    const touch = (id: number, x: number, y: number) => new Touch({ identifier: id, target: pane, ...at(x, y) });
    const send = (type: string, changed: Touch[], touches: Touch[]) =>
      pane.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: changed }));
    const pointer = (type: string, id: number, x: number, y: number, primary: boolean) =>
      pane.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, view: window, pointerId: id, pointerType: "touch", isPrimary: primary, button: 0,
        buttons: type === "pointerup" ? 0 : 1, ...at(x, y),
      }));
    // First finger lands, then the second, as fingers do: each touchstart carries only its own new touch.
    const a0 = touch(1, 500, 350);
    pointer("pointerdown", 1, 500, 350, true);
    send("touchstart", [a0], [a0]);
    const b0 = touch(2, 540, 350);
    pointer("pointerdown", 2, 540, 350, false);
    send("touchstart", [b0], [a0, b0]);
    // They spread apart.
    for (let i = 1; i <= 5; i++) {
      const a = touch(1, 500 - 20 * i, 350);
      const b = touch(2, 540 + 20 * i, 350);
      send("touchmove", [a, b], [a, b]);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const a1 = touch(1, 400, 350);
    const b1 = touch(2, 640, 350);
    send("touchend", [a1, b1], []);
    await expect.poll(() => drawnViewport().zoom).toBeGreaterThan(before.zoom * 1.5);
    expect(document.querySelector("[data-marquee]")).toBeNull();
  });
});

describe("two-finger pan (IR L58, L97, batch-2 #97)", () => {
  test("two fingers moving together pan without zooming", async () => {
    touchScreen();
    await sheet(2);
    const pane = paneElement();
    const before = drawnViewport();
    const at = (x: number, y: number) => client({ x, y });
    const touch = (id: number, x: number, y: number) => new Touch({ identifier: id, target: pane, ...at(x, y) });
    const send = (type: string, changed: Touch[], touches: Touch[]) =>
      pane.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches, targetTouches: touches, changedTouches: changed }));
    const pointer = (type: string, id: number, x: number, y: number, primary: boolean) =>
      pane.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, view: window, pointerId: id, pointerType: "touch", isPrimary: primary, button: 0,
        buttons: type === "pointerup" ? 0 : 1, ...at(x, y),
      }));
    const a0 = touch(1, 500, 350);
    pointer("pointerdown", 1, 500, 350, true);
    send("touchstart", [a0], [a0]);
    const b0 = touch(2, 540, 350);
    pointer("pointerdown", 2, 540, 350, false);
    send("touchstart", [b0], [a0, b0]);
    // Both fingers move the same distance in the same direction: the gap between them never changes.
    for (let i = 1; i <= 5; i++) {
      const a = touch(1, 500 - 20 * i, 350 - 10 * i);
      const b = touch(2, 540 - 20 * i, 350 - 10 * i);
      send("touchmove", [a, b], [a, b]);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const a1 = touch(1, 400, 300);
    const b1 = touch(2, 440, 300);
    send("touchend", [a1, b1], []);
    await expect.poll(() => drawnViewport().x).not.toBeCloseTo(before.x, 0);
    expect(drawnViewport().zoom).toBeCloseTo(before.zoom, 5);
    expect(document.querySelector("[data-marquee]")).toBeNull();
  });
});
