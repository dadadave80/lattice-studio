/**
 * Helpers for the interactions' browser tests (never imported by the app): the sheet inside a real sheet region
 * (S9's `useRegion`, so focus after a delete, an undo or a redo follows the document as in the shell), the
 * shortcut dispatcher installed, and pointer, mouse and key input aimed at cards and the empty sheet.
 */
import type { Layout, Point } from "@lattice-studio/core";
import { expect } from "vitest";
import { doc, KEY_CONTEXT_ATTRIBUTE, session, useRegion } from "@/contracts";
import { installShortcuts } from "@/commands";
import { overridePlatform } from "@/ui/shared/platform";
import { bufferedServices, onCleanup, renderWithStudio, type StudioOptions } from "../../../../test/harness";
import { Sheet } from "../../canvas/Sheet";
import { cardNode, flowElement, paneElement, settled, SHEET_HEIGHT, SHEET_WIDTH } from "../../canvas/testing/sheet-harness";

export { cardNode, drawnViewport, flowElement, paneElement, sheetProject, storedViewport } from "../../canvas/testing/sheet-harness";

function SheetRegion() {
  const region = useRegion("sheet");
  return (
    <main
      {...region}
      {...{ [KEY_CONTEXT_ATTRIBUTE]: "sheet" }}
      style={{ position: "relative", width: SHEET_WIDTH, height: SHEET_HEIGHT }}
    >
      <Sheet />
    </main>
  );
}

/** Renders the sheet in a 1000 × 700 sheet region with shortcuts on; motion reduced so view moves land at once. */
export async function renderInteractSheet(options: StudioOptions = {}) {
  // ⌘ is Mod in these tests, whatever machine runs them.
  onCleanup(overridePlatform("mac"));
  onCleanup(installShortcuts());
  const screen = await renderWithStudio(<SheetRegion />, { ...options, settings: { reduceMotion: "on", ...options.settings } });
  await settled();
  // The interactions layer arrives in its own chunk.
  await expect.poll(() => document.querySelector('[data-tour="place-facet"]')).not.toBeNull();
  // Its listeners attach in effects, after the first paint.
  await frame();
  await frame();
  return screen;
}

/** A card's top-left corner in the layout now. */
export function position(facet: string): Point {
  const entry = doc.get().layout[facet];
  if (!entry) throw new Error(`${facet} isn't on the sheet.`);
  return { x: entry.x, y: entry.y };
}

export function layoutNow(): Layout {
  return doc.get().layout;
}

export function selection(): string[] {
  return session.get().selection;
}

/** Everything announced so far. */
export function announced(): string[] {
  return bufferedServices().announce.map(([text]) => text);
}

/** A point relative to the sheet's top-left corner, as client coordinates. */
export function client(at: Point): { clientX: number; clientY: number } {
  const box = flowElement().getBoundingClientRect();
  return { clientX: box.left + at.x, clientY: box.top + at.y };
}

/** The middle of a card's header, relative to the sheet. */
export function cardPoint(facet: string, offset: Point = { x: 0, y: 0 }): Point {
  const sheet = flowElement().getBoundingClientRect();
  const r = cardNode(facet).getBoundingClientRect();
  return { x: r.left - sheet.left + 40 + offset.x, y: r.top - sheet.top + 16 + offset.y };
}

export type Modifiers = { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean };

/** A plain left click on a card (mousedown, mouseup, click), with modifiers. */
export function clickCard(facet: string, modifiers: Modifiers = {}): void {
  const target = cardNode(facet);
  const at = client(cardPoint(facet));
  const base = { bubbles: true, cancelable: true, view: window, button: 0, ...at, ...modifiers };
  target.dispatchEvent(new PointerEvent("pointerdown", { ...base, buttons: 1, pointerType: "mouse", isPrimary: true }));
  target.dispatchEvent(new MouseEvent("mousedown", { ...base, buttons: 1 }));
  target.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0, pointerType: "mouse", isPrimary: true }));
  target.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
  target.dispatchEvent(new MouseEvent("click", { ...base, buttons: 0 }));
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * A mouse drag on a card from its header by `by` screen px, in `steps` moves, holding at the end for `hold`
 * frames before letting go (edge auto-scroll runs while it's held).
 */
export async function dragCard(
  facet: string,
  by: Point,
  options: Modifiers & { steps?: number; hold?: number; from?: Point; release?: boolean } = {},
): Promise<void> {
  const { steps = 6, hold = 0, from, release = true, ...modifiers } = options;
  const target = cardNode(facet);
  const start = client(from ?? cardPoint(facet));
  const base = { bubbles: true, cancelable: true, view: window, button: 0, ...modifiers };
  target.dispatchEvent(new MouseEvent("mousedown", { ...base, ...start, buttons: 1 }));
  for (let i = 1; i <= steps; i++) {
    window.dispatchEvent(new MouseEvent("mousemove", {
      ...base, buttons: 1, clientX: start.clientX + (by.x * i) / steps, clientY: start.clientY + (by.y * i) / steps,
    }));
    await frame();
  }
  for (let i = 0; i < hold; i++) await frame();
  lastDrag = { clientX: start.clientX + by.x, clientY: start.clientY + by.y };
  if (release) await releaseDrag();
}

let lastDrag = { clientX: 0, clientY: 0 };

/** Lets go of a card drag started with `release: false`. */
export async function releaseDrag(): Promise<void> {
  window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0, buttons: 0, ...lastDrag }));
  await frame();
}

/** A pointer drag on empty sheet from `from` to `to` (relative to the sheet): the marquee. */
export async function marquee(from: Point, to: Point, options: Modifiers & { pointerType?: string; release?: boolean } = {}): Promise<void> {
  const { pointerType = "mouse", release = true, ...modifiers } = options;
  const pane = paneElement();
  const base = { bubbles: true, cancelable: true, view: window, button: 0, pointerId: 7, pointerType, isPrimary: true, ...modifiers };
  pane.dispatchEvent(new PointerEvent("pointerdown", { ...base, ...client(from), buttons: 1 }));
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    const at = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
    pane.dispatchEvent(new PointerEvent("pointermove", { ...base, ...client(at), buttons: 1 }));
    await frame();
  }
  if (release) pane.dispatchEvent(new PointerEvent("pointerup", { ...base, ...client(to), buttons: 0 }));
  await frame();
}

/** Lets go of the marquee's pointer at `at` (relative to the sheet). */
export async function releaseMarquee(at: Point): Promise<void> {
  const base = { bubbles: true, cancelable: true, view: window, button: 0, pointerId: 7, pointerType: "mouse", isPrimary: true };
  paneElement().dispatchEvent(new PointerEvent("pointerup", { ...base, ...client(at), buttons: 0 }));
  await frame();
}

/** A keydown on `target` (the focused element by default), as the dispatcher on `window` hears it. */
export function press(key: string, modifiers: Modifiers & { altKey?: boolean; code?: string } = {}, target: EventTarget | null = document.activeElement): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers });
  (target ?? document.body).dispatchEvent(event);
  return event;
}

/** The element with focus, as the facet its card belongs to (or null). */
export function focusedCard(): string | null {
  return document.activeElement?.closest<HTMLElement>(".react-flow__node[data-id]")?.dataset.id ?? null;
}
