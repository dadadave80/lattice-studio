/**
 * The keyboard twins (IR L14-L31, spec L749-L766): arrows nudge by the Nudge step (a burst is one undo step and
 * one merged announcement), arrows with nothing selected scroll the sheet, ⌘+arrow, Home and End move focus
 * and selection (panning an off-screen card into view first), Enter goes into a card's rows where ↑ ↓ move and
 * Space does what clicking the pin does, Esc comes back out, and Delete removes the selection with focus moving
 * per spec L755, and back to the restored card after undo.
 */
import type { CommandRef } from "@lattice-studio/core";
import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { commandState, doc, onCommandRun, session, settings } from "@/contracts";
import { readingOrder } from "@/a11y/positions";
import { bufferedServices, onCleanup } from "../../../test/harness";
import {
  announced, cardNode, drawnViewport, flowElement, focusedCard, position, press, renderInteractSheet, selection,
  sheetProject,
} from "./testing/interact-harness";

const ID = "keys";
const VIEW = { session: { viewports: { [ID]: { x: 60, y: 80, zoom: 1 } } } };

async function sheet(count = 4, columns = 4) {
  const project = sheetProject(count, { id: ID, columns });
  await renderInteractSheet({ project, ...VIEW });
  return project.recipe.facets as string[];
}

/** Focuses a card the way the keyboard does, and selects it. */
async function focusOn(facet: string): Promise<void> {
  session.set({ selection: [facet] });
  cardNode(facet).focus();
  await expect.poll(() => focusedCard()).toBe(facet);
}

function region(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-region="sheet"]');
  if (!el) throw new Error("No sheet region.");
  return el;
}

describe("nudge", () => {
  test("arrows move the selection 8 px, Shift+arrows 32 px; a burst is one undo step and one merged announcement", async () => {
    const [a] = await sheet();
    await focusOn(a as string);
    press("ArrowRight");
    expect(position(a as string)).toEqual({ x: 32, y: 24 });
    press("ArrowDown", { shiftKey: true });
    expect(position(a as string)).toEqual({ x: 32, y: 56 });
    press("ArrowRight");
    press("ArrowRight");
    expect(position(a as string)).toEqual({ x: 48, y: 56 });
    const nudges = bufferedServices().announce.filter(([, options]) => options?.merge === "nudge");
    expect(nudges).toHaveLength(4);
    expect(nudges.at(-1)?.[0]).toMatch(new RegExp(`^Moved ${a} right`));
    expect(doc.state().undoLabel).toBe(`Moved ${a}`);
    doc.undo();
    expect(position(a as string)).toEqual({ x: 24, y: 24 });
    expect(doc.state().canUndo).toBe(false);
  });

  test("the step is the Nudge step setting", async () => {
    const [a] = await sheet();
    settings.set({ nudge: { small: 16, large: 64 } });
    await focusOn(a as string);
    press("ArrowDown");
    press("ArrowRight", { shiftKey: true });
    expect(position(a as string)).toEqual({ x: 88, y: 40 });
  });

  test("with nothing selected the arrows scroll the sheet instead", async () => {
    await sheet();
    region().focus();
    const before = drawnViewport();
    press("ArrowRight", {}, region());
    await expect.poll(() => drawnViewport().x).toBeCloseTo(before.x - 48, 0);
    expect(doc.state().canUndo).toBe(false);
  });

  test("read-only: nudging says why it can't", async () => {
    const [a] = await sheet();
    await focusOn(a as string);
    session.set({ readOnly: "Read-only: this is a shared link" });
    expect(commandState({ id: "sheet.nudge", args: { dir: "left", step: "small" } })).toMatchObject({
      ok: false, reason: "Read-only: this is a shared link",
    });
    press("ArrowLeft");
    expect(position(a as string)).toEqual({ x: 24, y: 24 });
    expect(announced().at(-1)).toBe("Read-only: this is a shared link");
  });
});

describe("moving focus", () => {
  test("⌘+arrow moves focus and selection to the nearest card that way; none that way says so", async () => {
    const [a, b] = await sheet();
    await focusOn(a as string);
    const event = press("ArrowRight", { metaKey: true });
    expect(event.defaultPrevented).toBe(true);
    await expect.poll(() => focusedCard()).toBe(b);
    expect(selection()).toEqual([b]);
    press("ArrowLeft", { metaKey: true });
    await expect.poll(() => focusedCard()).toBe(a);
    press("ArrowLeft", { metaKey: true });
    expect(announced().at(-1)).toBe(`No card to the left of ${a}`);
    expect(focusedCard()).toBe(a);
  });

  test("⌘+arrow is consumed on the sheet even with no card focused", async () => {
    await sheet();
    region().focus();
    const event = press("ArrowLeft", { metaKey: true }, region());
    expect(event.defaultPrevented).toBe(true);
  });

  test("Home and End go to the first and last card in reading order", async () => {
    const facets = await sheet(6, 3);
    const order = readingOrder(doc.get().layout);
    await focusOn(facets[1] as string);
    press("End");
    await expect.poll(() => focusedCard()).toBe(order.at(-1));
    expect(selection()).toEqual([order.at(-1)]);
    press("Home");
    await expect.poll(() => focusedCard()).toBe(order[0]);
  });

  test("a keyboard move to an off-screen card pans it into view first", async () => {
    const facets = await sheet(6, 6);
    const last = facets[5] as string;
    const before = facets[4] as string;
    await focusOn(before);
    // The focused card in view, the next one just past the right edge.
    session.set((s) => ({ viewports: { ...s.viewports, [ID]: { x: -380, y: 80, zoom: 1 } } }));
    await expect.poll(() => drawnViewport().x).toBe(-380);
    const sheetBox = flowElement().getBoundingClientRect();
    expect(cardNode(last).getBoundingClientRect().left).toBeGreaterThan(sheetBox.right);
    press("ArrowRight", { metaKey: true });
    await expect.poll(() => focusedCard()).toBe(last);
    await expect.poll(() => {
      const r = cardNode(last).getBoundingClientRect();
      return r.left >= sheetBox.left && r.right <= sheetBox.right;
    }).toBe(true);
  });
});

describe("a card's rows", () => {
  test("Enter goes in, ↑ ↓ Home End move, Space does what clicking the pin does, Esc comes back out", async () => {
    const [a] = await sheet();
    await focusOn(a as string);
    press("Enter");
    const rows = [...cardNode(a as string).querySelectorAll<HTMLElement>("[data-card-row]")];
    expect(rows.length).toBeGreaterThan(2);
    await expect.poll(() => document.activeElement).toBe(rows[0]);
    expect(session.get().modes.rows).toBe(a);
    press("ArrowDown");
    expect(document.activeElement).toBe(rows[1]);
    press("ArrowUp");
    expect(document.activeElement).toBe(rows[0]);
    press("End");
    expect(document.activeElement).toBe(rows.at(-1));
    press("Home");
    expect(document.activeElement).toBe(rows[0]);

    const ran: CommandRef[] = [];
    onCleanup(onCommandRun((ref) => void ran.push(ref)));
    const pin = rows.find((row) => row.dataset.selector && row.dataset.state !== "seam");
    pin?.focus();
    await userEvent.keyboard(" ");
    await expect.poll(() => ran.length).toBeGreaterThan(0);
    expect(ran[0]?.args?.selector).toBe(pin?.dataset.selector);

    press("Escape", {}, document.activeElement);
    await expect.poll(() => focusedCard() === a && document.activeElement === cardNode(a as string)).toBe(true);
    expect(session.get().modes.rows).toBeNull();
  });
});

describe("Delete", () => {
  test("removes the selection; focus moves to the next card in reading order, and back to the restored card after undo", async () => {
    const [a, b] = await sheet();
    await focusOn(a as string);
    press("Delete");
    await expect.poll(() => doc.get().layout[a as string]).toBeUndefined();
    await expect.poll(() => focusedCard()).toBe(b);
    press("z", { metaKey: true, code: "KeyZ" });
    await expect.poll(() => doc.get().layout[a as string]).toBeDefined();
    await expect.poll(() => focusedCard()).toBe(a);
  });

  test("Backspace removes several; focus goes to the card after the last one removed, else the one before", async () => {
    const facets = await sheet(4);
    const [a, b, c, d] = facets as [string, string, string, string];
    session.set({ selection: [c, d] });
    cardNode(c).focus();
    press("Backspace");
    await expect.poll(() => Object.keys(doc.get().layout)).toEqual([a, b]);
    await expect.poll(() => focusedCard()).toBe(b);
    expect(bufferedServices().toast.at(-1)?.text).toBe("Removed 2 facets");
  });

  test("the last card gone: focus goes to the sheet", async () => {
    const [a] = await sheet(1);
    await focusOn(a as string);
    press("Delete");
    await expect.poll(() => document.activeElement).toBe(region());
  });
});
