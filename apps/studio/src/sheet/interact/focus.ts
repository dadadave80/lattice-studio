/**
 * Keyboard focus on the sheet (spec L744, L751, L755; IR L19-L22): which card has focus, how a card takes it
 * (panned clear of the floating UI first, then focused: S9's `provideCardFocus`), and the rows inside a card,
 * where ↑ ↓ move, Space does what clicking the pin does and Esc comes back out.
 */
import { doc, pushEscape, session } from "@/contracts";
import { cardElement } from "@/a11y/focus";
import { ensureVisible } from "@/sheet/canvas/sheet-view";

const FRAMES = 10;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * How a card takes focus on the sheet (S9's `provideCardFocus`): pan it clear of everything floating over the
 * sheet, then focus React Flow's node wrapper once it's rendered (after an undo it comes back a render later).
 * A keyboard move to an off-screen card pans first, then focuses (spec L755).
 */
export async function focusCardInView(facet: string): Promise<boolean> {
  ensureVisible(facet);
  for (let i = 0; i <= FRAMES; i++) {
    const el = cardElement(facet);
    if (el) {
      el.focus({ preventScroll: true });
      return document.activeElement === el;
    }
    await nextFrame();
  }
  return false;
}

/** The facet whose card holds `el` (the card itself or anything inside it). */
export function cardOf(el: Element | null): string | null {
  const card = el?.closest<HTMLElement>(".react-flow__node[data-id]");
  return card?.dataset.id ?? null;
}

/**
 * The card keyboard commands act from: the focused card, else the focus anchor's card, else the first selected
 * card on the sheet. Null when none applies.
 */
export function activeCard(): string | null {
  const layout = doc.get().layout;
  const focused = cardOf(document.activeElement);
  if (focused !== null && layout[focused]) return focused;
  const anchor = session.get().focus;
  const anchored = anchor?.kind === "facet" || anchor?.kind === "selector" ? anchor.facet : undefined;
  if (anchored !== undefined && layout[anchored]) return anchored;
  return session.get().selection.find((name) => layout[name]) ?? null;
}

/** A card's rows that take focus: its pin rows, then "+ n more" or Collapse. */
export function rowsOf(facet: string): HTMLElement[] {
  const card = cardElement(facet);
  return card ? [...card.querySelectorAll<HTMLElement>("[data-card-row]")] : [];
}

let leaveEscape: (() => void) | null = null;

function stopListening(): void {
  leaveEscape?.();
  leaveEscape = null;
}

/**
 * Leaves a card's rows (Esc, or focus moving out of them): the mode ends, and with `refocus` focus goes back to
 * the card.
 */
export function leaveRows(refocus: boolean): void {
  stopListening();
  const facet = session.get().modes.rows;
  if (facet === null) return;
  session.set((s) => ({ modes: { ...s.modes, rows: null } }));
  if (refocus) void focusCardInView(facet);
}

/**
 * Goes into a card's rows: focus moves to its first row and the session's `rows` mode names the card, so Esc
 * comes back out to the card (S2's Esc stack). False when the card draws no rows (compact, or not in the catalog).
 */
export function enterRows(facet: string): boolean {
  const [first] = rowsOf(facet);
  if (!first) return false;
  inRows(facet);
  void focusRow(first);
  return true;
}

/**
 * Focuses a row. A card's body paints only while it's on screen (`content-visibility: auto`), and a row in a
 * body the browser hasn't painted yet can't take focus, so this tries again for a few frames.
 */
async function focusRow(row: HTMLElement): Promise<boolean> {
  for (let i = 0; i <= FRAMES; i++) {
    row.focus({ preventScroll: true });
    if (document.activeElement === row) return true;
    await nextFrame();
  }
  return false;
}

/** The session's `rows` mode names `facet`, and Esc leaves it back to the card. */
function inRows(facet: string): void {
  if (session.get().modes.rows === facet && leaveEscape) return;
  stopListening();
  session.set((s) => ({ modes: { ...s.modes, rows: facet } }));
  leaveEscape = pushEscape(() => {
    if (session.get().modes.rows === null) return false;
    leaveRows(true);
    return true;
  });
}

/** ↑ ↓ Home End between a card's rows (IR L22). True when the key was one of them. */
export function moveBetweenRows(row: HTMLElement, key: string): boolean {
  const facet = cardOf(row);
  if (facet === null) return false;
  const rows = rowsOf(facet);
  const at = rows.indexOf(row);
  if (at < 0) return false;
  let next: HTMLElement | undefined;
  if (key === "ArrowDown") next = rows[Math.min(rows.length - 1, at + 1)];
  else if (key === "ArrowUp") next = rows[Math.max(0, at - 1)];
  else if (key === "Home") next = rows[0];
  else if (key === "End") next = rows.at(-1);
  else return false;
  inRows(facet);
  if (next) void focusRow(next);
  return true;
}
