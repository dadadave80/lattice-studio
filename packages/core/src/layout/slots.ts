import type { ContentBoundsFn, FreeSlotFn, PushBelowFn } from "../model/api";
import type { Layout, Rect } from "../model/layout";
import { cardRects, nearestFree, overlaps, rectOf, snapUp, unionRect } from "./geometry";

/**
 * Where a card lands (spec L425): at `at` snapped to `metrics.snap`, or, if that overlaps a card, the nearest
 * free spot in a spiral out from `at`. Cards that only touch edges don't overlap, so a slid card sits flush
 * against the card it was dropped on. Always returns a spot: cards never stack.
 */
export const freeSlot: FreeSlotFn = (layout, sizes, at, size, metrics) => {
  const obstacles = cardRects(layout, sizes, metrics).map((c) => c.rect);
  return nearestFree(obstacles, at, size, metrics.snap);
};

function sharesColumn(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x;
}

/**
 * `facet` grew by `dy` (expanding, spec L479); `sizes` holds the sizes from before the change. The cards below
 * it in the same column (overlapping its x range) move down by `dy` rounded up to `metrics.snap`, and so does
 * any other card one of them would then land on, so nothing overlaps. Relative positions within the moved set
 * are kept. `dy <= 0`, or a facet not on the sheet, returns `layout` itself: nothing is pulled up.
 */
export const pushBelow: PushBelowFn = (layout, sizes, facet, dy, metrics) => {
  const own = rectOf(layout, sizes, facet, metrics);
  if (!own || !(dy > 0)) return layout;
  const shift = snapUp(dy, metrics.snap);
  const grown: Rect = { ...own, height: own.height + dy };
  const others = cardRects(layout, sizes, metrics).filter((c) => c.name !== facet);
  const moved = new Set<string>();
  const blockers: Rect[] = [grown];
  const move = (name: string, rect: Rect): void => {
    moved.add(name);
    blockers.push({ ...rect, y: rect.y + shift });
  };
  for (const c of others) if (sharesColumn(c.rect, own) && c.rect.y >= own.y) move(c.name, c.rect);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of others) {
      if (moved.has(c.name)) continue;
      if (blockers.some((b) => overlaps(c.rect, b))) {
        move(c.name, c.rect);
        changed = true;
      }
    }
  }
  if (moved.size === 0) return layout;
  const out: Layout = { ...layout };
  for (const name of moved) {
    const entry = layout[name];
    if (entry) out[name] = { ...entry, y: entry.y + shift };
  }
  return out;
};

/** The bounding box of every card, for Fit and Back to content; null for an empty sheet. */
export const contentBounds: ContentBoundsFn = (layout, sizes) => {
  // Cards `sizes` doesn't list count as points: without metrics there's no size to assume.
  const rects = Object.keys(layout).flatMap((name) => {
    const entry = layout[name];
    if (!entry) return [];
    const size = sizes[name];
    return [{ x: entry.x, y: entry.y, width: size?.width ?? 0, height: size?.height ?? 0 }];
  });
  return unionRect(rects);
};
