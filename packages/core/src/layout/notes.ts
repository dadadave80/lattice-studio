import type { PlaceNotesFn } from "../model/api";
import type { NotePlacement, Point, Rect } from "../model/layout";
import { cardRects, center, nearestFree, nearestOn, overlaps, rectOf, simplify, snap, unionRect } from "./geometry";

/**
 * Note spacing, in grid units (the board's 40 px beside a target, 24 px above or below, 32 px off a tie's
 * midpoint), and the clearance a note keeps from cards and other notes (1).
 */
const SIDE_GAP = 5;
const END_GAP = 3;
const TIE_OFFSET = 4;
const CLEARANCE = 1;

/**
 * Margin notes (spec L435, L444, IR L107): each note goes beside its ties (at the first listed tie's midpoint)
 * or beside its cards, trying the board's spots in order, and otherwise the nearest free spot to the first.
 * A note never covers a card or an earlier note, keeping one grid step clear of both. Notes are placed in the
 * order given, so earlier notes get the better spots.
 *
 * `anchor` is the tie's midpoint, or the point of the first facet's card nearest the note. `leader` runs from
 * the anchor to the nearest point of the note's edge: one horizontal run, then one vertical. A note whose ties
 * and cards aren't on the sheet goes right of the content, with its anchor on its own left edge and no leader.
 */
export const placeNotes: PlaceNotesFn = ({ layout, sizes, traces, notes, metrics }) => {
  const g = metrics.grid;
  const obstacles: Rect[] = cardRects(layout, sizes, metrics).map((c) => c.rect);
  const byId = new Map(traces.map((t) => [t.id, t]));
  const out: NotePlacement[] = [];

  for (const note of notes) {
    const { width: w, height: h } = note.size;
    const ties = (note.traces ?? []).flatMap((id) => {
      const t = byId.get(id);
      return t ? [t] : [];
    });
    const cards = note.facets.flatMap((name) => {
      const r = rectOf(layout, sizes, name, metrics);
      return r ? [{ name, rect: r }] : [];
    });

    let candidates: Point[];
    let anchorFor: (rect: Rect) => Point;
    const firstTie = ties[0];
    const firstCard = cards[0];
    if (firstTie) {
      const mid = firstTie.mid;
      const tops = ties.flatMap((t) => [t.from, t.to]).flatMap((name) => {
        const r = rectOf(layout, sizes, name, metrics);
        return r ? [r.y] : [];
      });
      const top = tops.length > 0 ? Math.min(...tops) : mid.y;
      candidates = [
        { x: mid.x + SIDE_GAP * g, y: mid.y - h / 2 },
        { x: mid.x - SIDE_GAP * g - w, y: mid.y - h / 2 },
        { x: mid.x + SIDE_GAP * g, y: mid.y + TIE_OFFSET * g },
        { x: mid.x + SIDE_GAP * g, y: mid.y - TIE_OFFSET * g - h },
        { x: mid.x - w / 2, y: top - h - END_GAP * g },
      ];
      anchorFor = () => ({ x: mid.x, y: mid.y });
    } else if (firstCard) {
      const t = unionRect(cards.map((c) => c.rect)) ?? firstCard.rect;
      const pinsRight = layout[firstCard.name]?.pins === "right";
      const left = { x: t.x - SIDE_GAP * g - w, y: t.y };
      const right = { x: t.x + t.width + SIDE_GAP * g, y: t.y };
      candidates = [
        { x: t.x, y: t.y - h - END_GAP * g },
        pinsRight ? left : right,
        pinsRight ? right : left,
        { x: t.x, y: t.y + t.height + END_GAP * g },
      ];
      anchorFor = (rect) => nearestOn(center(rect), firstCard.rect);
    } else {
      const bounds = unionRect([...obstacles, ...out.map((p) => p.rect)]);
      candidates = [bounds ? { x: bounds.x + bounds.width + SIDE_GAP * g, y: bounds.y } : { x: 0, y: 0 }];
      anchorFor = (rect) => ({ x: rect.x, y: rect.y + rect.height / 2 });
    }

    const taken = [...obstacles, ...out.map((p) => p.rect)];
    const fits = (p: Point): boolean => !taken.some((o) => overlaps({ ...p, width: w, height: h }, o, CLEARANCE * g));
    const snapped = candidates.map((p) => ({ x: snap(p.x, metrics.snap), y: snap(p.y, metrics.snap) }));
    const first = snapped[0] ?? { x: 0, y: 0 };
    const at = snapped.find(fits) ?? nearestFree(taken, first, { width: w, height: h }, metrics.snap, CLEARANCE * g);
    const rect = { x: at.x, y: at.y, width: w, height: h };
    const anchor = anchorFor(rect);
    const leader = firstTie || firstCard ? leaderTo(anchor, rect) : [];
    out.push({ id: note.id, rect, anchor, leader });
  }
  return out;
};

/** From `anchor` to the nearest point of `rect`: horizontal, then vertical; empty when the anchor is on it. */
function leaderTo(anchor: Point, rect: Rect): Point[] {
  const end = nearestOn(anchor, rect);
  const points = simplify([anchor, { x: end.x, y: anchor.y }, end]);
  return points.length < 2 ? [] : points;
}
