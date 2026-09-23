/**
 * Move to… (Flow 8, IR L44, spec L762): the single-pointer and keyboard way to move the selection. M or the
 * card menu starts it; the interactions layer shows a ghost that follows the pointer or a crosshair moved with
 * the arrows; a click or Enter drops it, Esc cancels. The drop is one undo step, settled like a drag.
 */
import type { Point } from "@lattice-studio/core";
import { announce, doc, log, session } from "@/contracts";
import { focusCardInView } from "./card-focus";
import { activeCard } from "./focus";
import { cardsWord, moveGroup, moveLabel, movedWords } from "./moves";
import { placedSelection } from "./selection";

/** The card focus returns to when Move to… ends. */
let home: string | null = null;

/** What Move to… says when it starts. */
export function moveToWords(names: readonly string[]): string {
  return `Moving ${cardsWord(names)}. Click the destination, or move with the arrows and press Enter. Esc cancels.`;
}

/** Starts Move to… for the selection. */
export function startMoveTo(): void {
  const s = session.get();
  const names = placedSelection(doc.get().layout, s.selection);
  if (names.length === 0) return;
  home = activeCard() ?? names[0] ?? null;
  session.set({ modes: { ...s.modes, moveTo: true, rows: null } });
  announce(moveToWords(names));
}

function finish(): void {
  session.set((s) => ({ modes: { ...s.modes, moveTo: false } }));
  const card = home;
  home = null;
  if (card !== null && doc.get().layout[card]) void focusCardInView(card);
}

/** Esc (or M again): leaves Move to… without moving anything. */
export function cancelMoveTo(): void {
  if (!session.get().modes.moveTo) return;
  finish();
  announce("Move canceled.");
}

/**
 * Drops the selection moved by `by` (sheet units), settled so no card lands on another: one undo step. A drop
 * where the cards already are moves nothing and says so.
 */
export function dropMoveTo(by: Point): void {
  if (!session.get().modes.moveTo) return;
  const names = placedSelection(doc.get().layout, session.get().selection);
  if (names.length === 0 || (by.x === 0 && by.y === 0)) {
    finish();
    const text = "Nothing moved: that's where the cards are.";
    log({ tag: "Note", text });
    announce(text);
    return;
  }
  const result = doc.apply(moveLabel(names), moveGroup(names, by));
  finish();
  if (result.changed) announce(movedWords(names, doc.get().layout));
}
