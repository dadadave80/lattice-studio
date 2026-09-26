/**
 * Selecting cards (IR L42, L49-L50, spec L745). The selection lives in the session; a card states it in its
 * description, and because a `group` can't carry `aria-selected`, every change made here is also announced.
 */
import { plural } from "@lattice-studio/core";
import { announce, session } from "@/contracts";

/** What a selection change says: "Selected ERC20.", "Selected 3 cards.", "Selection cleared." */
export function selectionWords(selection: readonly string[]): string {
  if (selection.length === 0) return "Selection cleared.";
  if (selection.length === 1) return `Selected ${selection[0] ?? ""}.`;
  return `Selected ${plural(selection.length, "card")}.`;
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

/**
 * Sets the selection and announces it (merged, so a marquee sweeping over cards reads once). A selection that
 * doesn't change says nothing. Returns whether it changed.
 */
export function select(next: readonly string[], options: { quiet?: boolean } = {}): boolean {
  const before = session.get().selection;
  if (same(before, next)) return false;
  session.set({ selection: [...next] });
  if (!options.quiet) announce(selectionWords(next), { merge: "selection" });
  return true;
}

/** The selected facets that have a card on the sheet, in selection order. */
export function placedSelection(layout: Readonly<Record<string, unknown>>, selection: readonly string[]): string[] {
  return selection.filter((name) => Object.hasOwn(layout, name));
}
