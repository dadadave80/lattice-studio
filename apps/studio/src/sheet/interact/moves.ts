/**
 * Moving cards as document edits (Flow 8): a drag's frames, a nudge, a group moved by an offset and settled so it
 * never lands on another card, and what the move says in words, never pixels (spec L672, L776). The edits are
 * core's (C11's `applyLayout` and `moveCards`); the geometry that settles them is `geometry.ts`.
 */
import type { EditResult, Layout, Point, Project } from "@lattice-studio/core";
import { applyLayout, moveCards, plural } from "@lattice-studio/core";
import { layoutMetrics, type EditOp } from "@/contracts";
import { positionInWords, readingOrder } from "@/a11y/positions";
import { clearStep, settledOffset, without } from "./geometry";
import { currentSizes } from "./sheet-space";

/** "ERC20" or "3 cards": the subject of a move. */
export function cardsWord(names: readonly string[]): string {
  return names.length === 1 ? (names[0] ?? "") : plural(names.length, "card");
}

/** The undo label a move of `names` gets, as core's `moveCards` words it: "Moved ERC20", "Moved 3 cards". */
export function moveLabel(names: readonly string[]): string {
  return `Moved ${cardsWord(names)}`;
}

/** `layout` with `names` moved from where `base` had them by `by`. */
export function shifted(base: Layout, layout: Layout, names: readonly string[], by: Point): Layout {
  const out: Layout = { ...layout };
  for (const name of names) {
    const entry = base[name];
    if (entry) out[name] = { ...entry, x: entry.x + by.x, y: entry.y + by.y };
  }
  return out;
}

/** Sets `names` to where `base` had them, moved by `by`: one frame of a drag. */
export function placeFrom(base: Layout, names: readonly string[], by: Point): EditOp {
  return (project: Project): EditResult => applyLayout(project, shifted(base, project.layout, names, by));
}

/**
 * One nudge (IR L23): `names` moved by `by`, from where they are. Cards never stack (spec L425), so when that
 * would put one on another card, the group goes on in the same direction to the first spot, in whole steps,
 * where none does: a nudge passes a card rather than landing on it. The store merges a burst into one step.
 */
export function nudged(names: readonly string[], by: Point): EditOp {
  return (project: Project): EditResult => {
    const offset = clearStep(project.layout, currentSizes(), names, by, layoutMetrics);
    return moveCards(project, names, offset);
  };
}

/**
 * Moves `names` by `by`, settled: when a card would land on another one, the group slides to the nearest free
 * slot (Flow 8). One undo step when applied with `doc.apply`.
 */
export function moveGroup(names: readonly string[], by: Point): EditOp {
  return (project: Project): EditResult => {
    const offset = settledOffset(project.layout, currentSizes(), names, by, layoutMetrics);
    return moveCards(project, names, offset);
  };
}

/**
 * Where moved cards ended up, in words: "Moved ERC20, beside ERC4626.", "Moved 3 cards, above Vault." (the
 * first moved card in reading order, against the cards that stayed).
 */
export function movedWords(names: readonly string[], layout: Layout): string {
  const placed: Layout = {};
  for (const name of names) {
    const entry = layout[name];
    if (entry) placed[name] = entry;
  }
  const moved = Object.keys(placed);
  const first = readingOrder(placed)[0];
  const entry = first === undefined ? undefined : placed[first];
  const where = first !== undefined && entry ? positionInWords(first, { ...without(layout, moved), [first]: entry }) : null;
  return where ? `Moved ${cardsWord(moved)}, ${where}.` : `Moved ${cardsWord(moved)}.`;
}
