/**
 * Dragging cards (Flow 8, IR L43): a 4 px threshold, 8 px snap, the whole selection, one undo step, a drop on
 * another card sliding to the nearest free slot, and the view scrolling near the edge, faster deeper in.
 */
import { describe, expect, test } from "vitest";
import { doc, session } from "@/contracts";
import { bufferedServices } from "../../../test/harness";
import {
  announced, cardNode, client, cardPoint, clickCard, dragCard, drawnViewport, position, renderInteractSheet, selection,
  sheetProject, storedViewport,
} from "./testing/interact-harness";

const ID = "drag";
/** 100% zoom, with the cards clear of the 48 px edge zones. */
const AT_ORIGIN = { session: { viewports: { [ID]: { x: 60, y: 80, zoom: 1 } } } };

async function sheet(count = 4) {
  const project = sheetProject(count, { id: ID });
  await renderInteractSheet({ project, ...AT_ORIGIN });
  return project.recipe.facets as [string, string, string, string];
}

function overlap(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

describe("dragging a card", () => {
  test("moves it by the pointer's offset, snapped to 8 px, as one undo step", async () => {
    const [a] = await sheet();
    const before = position(a);
    await dragCard(a, { x: 45, y: 367 });
    // (24, 24) + (45, 367) = (69, 391), snapped to (72, 392): clear of every other card.
    expect(position(a)).toEqual({ x: 72, y: 392 });
    expect(selection()).toEqual([a]);
    expect(doc.state().canUndo).toBe(true);
    expect(doc.state().undoLabel).toBe(`Moved ${a}`);
    expect(announced().some((text) => text.startsWith(`Moved ${a}`))).toBe(true);
    doc.undo();
    expect(position(a)).toEqual(before);
    expect(doc.state().canUndo).toBe(false);
  });

  test("under the 4 px threshold nothing moves", async () => {
    const [a] = await sheet();
    await dragCard(a, { x: 3, y: 0 }, { steps: 1 });
    expect(position(a)).toEqual({ x: 24, y: 24 });
    expect(doc.state().canUndo).toBe(false);
  });

  test("the whole selection moves together, one step", async () => {
    const [a, , c] = await sheet();
    clickCard(a);
    clickCard(c, { shiftKey: true });
    const cBefore = position(c);
    await dragCard(a, { x: 0, y: 300 });
    const by = { x: position(a).x - 24, y: position(a).y - 24 };
    expect(by.y).toBeGreaterThan(290);
    expect(position(c)).toEqual({ x: cBefore.x + by.x, y: cBefore.y + by.y });
    doc.undo();
    expect(position(a)).toEqual({ x: 24, y: 24 });
    expect(position(c)).toEqual(cBefore);
    expect(doc.state().canUndo).toBe(false);
  });

  test("grabbing a card that isn't selected selects it and moves only it", async () => {
    const [a, b] = await sheet();
    clickCard(b);
    await dragCard(a, { x: 0, y: 320 });
    expect(selection()).toEqual([a]);
    expect(position(b)).toEqual({ x: 296, y: 24 });
    expect(position(a).y).toBeGreaterThan(300);
  });

  test("dropped onto another card, it slides to the nearest free slot", async () => {
    const [a, b] = await sheet();
    await dragCard(a, { x: 272, y: 0 });
    await expect.poll(() => overlap(cardNode(a).getBoundingClientRect(), cardNode(b).getBoundingClientRect())).toBe(false);
    expect(position(a)).not.toEqual({ x: 296, y: 24 });
    expect(doc.state().undoLabel).toBe(`Moved ${a}`);
  });

  test("read-only: nothing moves, and the reason is logged", async () => {
    const [a] = await sheet();
    session.set({ readOnly: "Read-only: this is a shared link" });
    await dragCard(a, { x: 80, y: 80 });
    expect(position(a)).toEqual({ x: 24, y: 24 });
    expect(bufferedServices().log.some((line) => line.text === "Read-only: this is a shared link")).toBe(true);
  });
});

describe("edge auto-scroll", () => {
  test("near the edge the view scrolls, faster deeper in, the card keeps up, and the view is stored once at the end", async () => {
    const [a] = await sheet();
    const start = client(cardPoint(a));
    const target = cardNode(a);
    const base = { bubbles: true, cancelable: true, view: window, button: 0 };
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const stored = storedViewport();
    target.dispatchEvent(new MouseEvent("mousedown", { ...base, ...start, buttons: 1 }));
    const sheetBox = document.querySelector(".react-flow")?.getBoundingClientRect();
    if (!sheetBox) throw new Error("No sheet.");
    const moveTo = (x: number) =>
      window.dispatchEvent(new MouseEvent("mousemove", { ...base, buttons: 1, clientX: sheetBox.left + x, clientY: start.clientY }));

    // Just inside the 48 px zone at the right edge: a slow scroll.
    moveTo(500);
    await frame();
    moveTo(960);
    const shallow0 = drawnViewport().x;
    for (let i = 0; i < 5; i++) await frame();
    const shallow = shallow0 - drawnViewport().x;
    // Deeper in: faster.
    moveTo(996);
    const deep0 = drawnViewport().x;
    for (let i = 0; i < 5; i++) await frame();
    const deep = deep0 - drawnViewport().x;
    expect(shallow).toBeGreaterThan(0);
    expect(deep).toBeGreaterThan(shallow);
    // Not stored while it scrolls.
    expect(storedViewport()).toEqual(stored);

    // The card stays under the pointer: its screen position follows the pointer, not the scrolled sheet.
    const grabbed = cardPoint(a);
    expect(Math.abs(grabbed.x - 996)).toBeLessThan(16);

    window.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0, clientX: sheetBox.left + 996, clientY: start.clientY }));
    await frame();
    const drawn = drawnViewport();
    expect(storedViewport()?.x).toBeCloseTo(drawn.x, 0);
    expect(doc.state().undoLabel).toBe(`Moved ${a}`);
    doc.undo();
    expect(position(a)).toEqual({ x: 24, y: 24 });
  });
});
