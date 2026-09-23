/**
 * Focus movement (spec L755): after a delete, the next card in reading order, else the previous one, else
 * the sheet; after undo or redo, the restored card; and back to the invoker when a mode or popover closes.
 *
 * Cards are found in the sheet region by React Flow's node wrapper (`.react-flow__node[data-id]`), which S4b's
 * roving focus makes focusable, or by `[data-facet]`. S4e can replace how a card takes focus (to pan an
 * off-screen card into view first) with `provideCardFocus`.
 */
import type { DocumentState } from "@/contracts";
import { session } from "@/contracts";
import { nextAfterDelete, readingOrder, restoredCard } from "./positions";

/** Focuses a card; resolves true when focus landed on it. */
export type CardFocuser = (facet: string) => boolean | Promise<boolean>;

const FRAMES = 10;

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function sheetRoot(): ParentNode {
  return document.querySelector<HTMLElement>('[data-region="sheet"]') ?? document;
}

/** The element that takes focus for a card, if it's rendered. */
export function cardElement(facet: string): HTMLElement | null {
  const name = CSS.escape(facet);
  const root = sheetRoot();
  return (
    root.querySelector<HTMLElement>(`.react-flow__node[data-id="${name}"]`) ??
    root.querySelector<HTMLElement>(`[data-facet="${name}"]`)
  );
}

function focusWithin(el: HTMLElement): boolean {
  el.focus();
  if (document.activeElement === el) return true;
  const inner = el.querySelector<HTMLElement>("[tabindex], button, a[href], input, select, textarea");
  inner?.focus();
  return !!inner && document.activeElement === inner;
}

/** Waits a few frames for the card to render (after undo it comes back on the next render), then focuses it. */
async function domCardFocus(facet: string): Promise<boolean> {
  for (let i = 0; i <= FRAMES; i++) {
    const el = cardElement(facet);
    if (el) return focusWithin(el);
    await nextFrame();
  }
  return false;
}

let focusCardImpl: CardFocuser = domCardFocus;

/** S4e: replaces how a card takes focus (pan it into view, then focus). Returns a disposer. */
export function provideCardFocus(focuser: CardFocuser): () => void {
  const previous = focusCardImpl;
  focusCardImpl = focuser;
  return () => {
    if (focusCardImpl === focuser) focusCardImpl = previous;
  };
}

/** Focuses a card and records it as the session's focus anchor. */
export async function focusCard(facet: string): Promise<boolean> {
  session.set({ focus: { kind: "facet", facet } });
  return focusCardImpl(facet);
}

/** Focuses the sheet: its region container. */
export function focusSheet(): boolean {
  const el = document.querySelector<HTMLElement>('[data-region="sheet"]');
  if (!el) return false;
  el.focus();
  return document.activeElement === el;
}

/**
 * After `removed` leave the sheet: the next card in reading order, else the previous one, else the sheet.
 * `before` is the layout before the delete. Resolves with the card focused, or null for the sheet.
 */
export async function focusAfterDelete(removed: readonly string[], before: DocumentState["project"]["layout"]): Promise<string | null> {
  const target = nextAfterDelete(removed, readingOrder(before));
  if (target !== null && (await focusCard(target))) return target;
  session.set({ focus: null });
  focusSheet();
  return null;
}

/** After undo or redo: the restored card. Resolves with it, or null when nothing came back (focus stays). */
export async function focusAfterHistory(
  before: DocumentState["project"]["layout"],
  after: DocumentState["project"]["layout"],
): Promise<string | null> {
  const target = restoredCard(before, after);
  if (target === null) return null;
  return (await focusCard(target)) ? target : null;
}

/**
 * Remembers what has focus now; call the result to put focus back (a popover, Move to… or a mode closing).
 * When the invoker is gone, focus goes to the sheet. Resolves true when focus landed on the invoker.
 */
export function captureInvoker(active: Element | null = document.activeElement): () => boolean {
  const invoker = active instanceof HTMLElement && active !== document.body ? active : null;
  return () => {
    if (invoker?.isConnected) {
      invoker.focus();
      if (document.activeElement === invoker) return true;
    }
    focusSheet();
    return false;
  };
}

function typing(el: Element | null): boolean {
  return !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable));
}

/** The facet a card element (or anything inside one) belongs to. */
function cardOf(el: Element | null): string | null {
  const card = el?.closest<HTMLElement>(".react-flow__node[data-id], [data-facet]");
  return card?.dataset.id ?? card?.dataset.facet ?? null;
}

/**
 * Subscribed to the document while regions are mounted. When a change removes the card that has focus
 * (Delete, the Structure tree, undoing a place), focus follows the delete rule; after an undo or redo that
 * brings a card back, focus goes to it, unless a dialog is open or someone is typing.
 */
export function followDocument(state: DocumentState, previous: DocumentState): void {
  const before = previous.project.layout;
  const after = state.project.layout;
  if (before === after) return;
  const focused = cardOf(document.activeElement);
  const removed = Object.keys(before).filter((name) => !after[name]);
  if (focused !== null && removed.includes(focused)) {
    void focusAfterDelete(removed, before);
    return;
  }
  const kind = state.lastChange?.kind;
  if (kind !== "undo" && kind !== "redo") return;
  if (session.get().dialogs.length || typing(document.activeElement)) return;
  void focusAfterHistory(before, after);
}
