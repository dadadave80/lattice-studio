/**
 * Positions in words, never pixels (spec L672, L777): reading order for focus and Home/End, and the words a
 * move is announced with ("Moved ERC20 right, beside ERC4626"). Pure: the layout and card height come in.
 */
import type { Layout } from "@lattice-studio/core";
import type { Direction } from "@/contracts";

/**
 * Cards whose tops sit within this many sheet units of a row's first card read as one row. Tidy snaps to
 * the 8-unit grid, but hand-placed cards drift, so the default is a card header's height (40).
 */
export const ROW_TOLERANCE = 40;

/** Facet names in reading order: rows top to bottom, each row left to right; ties by name. */
export function readingOrder(layout: Layout, tolerance: number = ROW_TOLERANCE): string[] {
  const cards = Object.entries(layout)
    .map(([name, at]) => ({ name, x: at.x, y: at.y }))
    .sort((a, b) => a.y - b.y || a.x - b.x || compare(a.name, b.name));
  const rows: (typeof cards)[] = [];
  let top = Number.NEGATIVE_INFINITY;
  for (const card of cards) {
    const row = rows.at(-1);
    if (row && card.y - top <= tolerance) row.push(card);
    else {
      rows.push([card]);
      top = card.y;
    }
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x || compare(a.name, b.name)).map((c) => c.name));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Where a card is, in words, relative to its nearest neighbor (by distance between top-left corners):
 * "beside ERC4626" when the neighbor is more to the side than above or below, else "above ERC4626" or
 * "below ERC4626". Null when the card is alone on the sheet or not on it.
 */
export function positionInWords(facet: string, layout: Layout): string | null {
  const at = layout[facet];
  if (!at) return null;
  let best: { name: string; dx: number; dy: number; d: number } | null = null;
  for (const [name, other] of Object.entries(layout)) {
    if (name === facet) continue;
    const dx = other.x - at.x;
    const dy = other.y - at.y;
    const d = Math.hypot(dx, dy);
    if (!best || d < best.d || (d === best.d && compare(name, best.name) < 0)) best = { name, dx, dy, d };
  }
  if (!best) return null;
  if (Math.abs(best.dx) >= Math.abs(best.dy)) return `beside ${best.name}`;
  // The neighbor is below the card: the card is above it.
  return best.dy > 0 ? `above ${best.name}` : `below ${best.name}`;
}

const DIRECTION_WORDS: Readonly<Record<Direction, string>> = { left: "left", right: "right", up: "up", down: "down" };

/**
 * The merged announcement for a nudge burst, from the layout after it: "Moved ERC20 right, beside ERC4626",
 * "Moved 3 cards up, above Vault" (positioned by the first moved card in reading order). Pass it to
 * `announce` with `merge: "nudge"` so a burst of presses reads once.
 */
export function describeMove(facets: readonly string[], dir: Direction, layout: Layout): string {
  const moved = readingOrder(Object.fromEntries(facets.flatMap((f) => (layout[f] ? [[f, layout[f]]] : []))));
  const subject = facets.length === 1 ? (facets[0] ?? "") : `${facets.length} cards`;
  const first = moved[0];
  const rest = Object.fromEntries(Object.entries(layout).filter(([name]) => name === first || !facets.includes(name)));
  const where = first === undefined ? null : positionInWords(first, rest);
  return where ? `Moved ${subject} ${DIRECTION_WORDS[dir]}, ${where}` : `Moved ${subject} ${DIRECTION_WORDS[dir]}`;
}

/** Where focus goes after `removed` leave the sheet (spec L755): the next card in reading order, else the previous one, else null (the sheet). */
export function nextAfterDelete(removed: readonly string[], orderBefore: readonly string[]): string | null {
  const gone = new Set(removed);
  let last = -1;
  let first = -1;
  orderBefore.forEach((name, i) => {
    if (!gone.has(name)) return;
    if (first < 0) first = i;
    last = i;
  });
  if (first < 0) return null;
  for (let i = last + 1; i < orderBefore.length; i++) {
    const name = orderBefore[i];
    if (name !== undefined && !gone.has(name)) return name;
  }
  for (let i = first - 1; i >= 0; i--) {
    const name = orderBefore[i];
    if (name !== undefined && !gone.has(name)) return name;
  }
  return null;
}

/**
 * The card an undo or redo brought back (spec L755): the first card, in reading order, that is on the sheet
 * after but wasn't before; else the first whose place or pins changed; else null (focus stays).
 */
export function restoredCard(before: Layout, after: Layout): string | null {
  const order = readingOrder(after);
  const added = order.find((name) => !before[name]);
  if (added !== undefined) return added;
  return (
    order.find((name) => {
      const a = before[name];
      const b = after[name];
      return !!a && !!b && (a.x !== b.x || a.y !== b.y || a.pins !== b.pins || a.expanded !== b.expanded);
    }) ?? null
  );
}
