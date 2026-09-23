/**
 * Move to… (Flow 8, IR L28, L44; spec L762): the single-pointer and keyboard way to move cards, with no drag at
 * all. M or the card menu starts it; a click drops the ghost, or the arrows move a crosshair and Enter drops it;
 * Esc cancels. One undo step, and the selection moves together.
 */
import { describe, expect, test } from "vitest";
import { commandState, doc, session, settings } from "@/contracts";
import {
  announced, cardNode, client, focusedCard, paneElement, position, press, renderInteractSheet, sheetProject,
} from "./testing/interact-harness";

const ID = "move-to";
const VIEW = { session: { viewports: { [ID]: { x: 60, y: 80, zoom: 1 } } } };

async function sheet(count = 4) {
  const project = sheetProject(count, { id: ID });
  await renderInteractSheet({ project, ...VIEW });
  return project.recipe.facets as [string, string, string, string];
}

async function focusOn(facet: string): Promise<void> {
  session.set({ selection: [facet] });
  cardNode(facet).focus();
  await expect.poll(() => focusedCard()).toBe(facet);
}

/** The pointer over the sheet at `at` (relative to it), then a single click there: no press-and-move. */
function clickAt(at: { x: number; y: number }): void {
  const target = paneElement();
  const base = { bubbles: true, cancelable: true, view: window, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true, ...client(at) };
  target.dispatchEvent(new PointerEvent("pointermove", { ...base, buttons: 0 }));
  target.dispatchEvent(new PointerEvent("pointerdown", { ...base, buttons: 1 }));
  target.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0 }));
  target.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));
}

describe("Move to…", () => {
  test("M, then a click drops the selection where the ghost is: one undo step, no drag", async () => {
    const [a] = await sheet();
    await focusOn(a);
    press("m");
    expect(session.get().modes.moveTo).toBe(true);
    expect(announced().at(-1)).toBe(`Moving ${a}. Click the destination, or move with the arrows and press Enter. Esc cancels.`);
    await expect.poll(() => document.querySelector("[data-move-to]")).not.toBeNull();
    // The pointer at (500, 500) on screen is (440, 420) on the sheet; it holds the card by its header's middle.
    clickAt({ x: 500, y: 500 });
    expect(session.get().modes.moveTo).toBe(false);
    expect(position(a)).toEqual({ x: 328, y: 400 });
    expect(doc.state().undoLabel).toBe(`Moved ${a}`);
    expect(announced().at(-1)).toMatch(new RegExp(`^Moved ${a}`));
    await expect.poll(() => focusedCard()).toBe(a);
    doc.undo();
    expect(position(a)).toEqual({ x: 24, y: 24 });
    expect(doc.state().canUndo).toBe(false);
  });

  test("the crosshair: arrows move it by the Nudge step, Shift for the large one, and Enter drops it", async () => {
    const [a] = await sheet();
    await focusOn(a);
    press("m");
    await expect.poll(() => document.querySelector("[data-move-to]")).not.toBeNull();
    press("ArrowRight");
    press("ArrowRight");
    press("ArrowDown", { shiftKey: true });
    expect(position(a)).toEqual({ x: 24, y: 24 });
    await expect.poll(() => document.querySelector("[data-move-to]")?.textContent).toBe("40 · 56");
    expect(announced().at(-1)).toMatch(new RegExp(`^Moving ${a}`));
    press("Enter");
    expect(position(a)).toEqual({ x: 40, y: 56 });
    expect(session.get().modes.moveTo).toBe(false);
    doc.undo();
    expect(position(a)).toEqual({ x: 24, y: 24 });
  });

  test("the crosshair follows the Nudge step setting", async () => {
    const [a] = await sheet();
    settings.set({ nudge: { small: 16, large: 64 } });
    await focusOn(a);
    press("m");
    await expect.poll(() => document.querySelector("[data-move-to]")).not.toBeNull();
    press("ArrowDown", { shiftKey: true });
    press("ArrowRight");
    press("Enter");
    expect(position(a)).toEqual({ x: 40, y: 88 });
  });

  test("Esc cancels: nothing moves, focus stays on the card", async () => {
    const [a] = await sheet();
    await focusOn(a);
    press("m");
    await expect.poll(() => document.querySelector("[data-move-to]")).not.toBeNull();
    press("ArrowDown");
    press("Escape");
    expect(session.get().modes.moveTo).toBe(false);
    expect(position(a)).toEqual({ x: 24, y: 24 });
    expect(announced().at(-1)).toBe("Move canceled.");
    expect(doc.state().canUndo).toBe(false);
    await expect.poll(() => document.querySelector("[data-move-to]")).toBeNull();
    await expect.poll(() => focusedCard()).toBe(a);
  });

  test("the selected cards move together", async () => {
    const [a, b, c] = await sheet();
    session.set({ selection: [a, c] });
    cardNode(a).focus();
    press("m");
    await expect.poll(() => document.querySelector("[data-move-to]")).not.toBeNull();
    for (let i = 0; i < 10; i++) press("ArrowDown", { shiftKey: true });
    press("Enter");
    expect(position(a)).toEqual({ x: 24, y: 344 });
    expect(position(c)).toEqual({ x: 568, y: 344 });
    expect(position(b)).toEqual({ x: 296, y: 24 });
    doc.undo();
    expect(position(c)).toEqual({ x: 568, y: 24 });
  });

  test("a drop onto another card slides to the nearest free slot", async () => {
    const [a, b] = await sheet();
    await focusOn(a);
    press("m");
    await expect.poll(() => document.querySelector("[data-move-to]")).not.toBeNull();
    for (let i = 0; i < 9; i++) press("ArrowRight", { shiftKey: true });
    press("Enter");
    await expect.poll(() => {
      const r = cardNode(a).getBoundingClientRect();
      const o = cardNode(b).getBoundingClientRect();
      return r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top;
    }).toBe(false);
    expect(position(a)).not.toEqual({ x: 312, y: 24 });
    expect(doc.state().undoLabel).toBe(`Moved ${a}`);
  });

  test("Move to… needs a selection, and says why it can't read-only", async () => {
    const [a] = await sheet();
    expect(commandState({ id: "sheet.moveTo" })).toMatchObject({ ok: false, reason: "Select a card first" });
    session.set({ selection: [a], readOnly: "Read-only: this is a shared link" });
    expect(commandState({ id: "sheet.moveTo" })).toMatchObject({ ok: false, reason: "Read-only: this is a shared link" });
  });
});
