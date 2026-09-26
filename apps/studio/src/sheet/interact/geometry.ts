/**
 * The sheet's interaction arithmetic (Flow 3, Flow 8, IR L19-L23, L40-L58), pure so it's tested without a
 * browser: snapping, where a moved group settles, which cards a marquee touches, the nearest card in a
 * direction, and how fast the view scrolls near an edge. Card rectangles come from token-computed sizes
 * (spec L824), never from what the DOM measured.
 */
import type { Layout, LayoutMetrics, Point, Rect, Size, Sizes } from "@lattice-studio/core";
import { freeSlot } from "@lattice-studio/core";
import { layoutSizes } from "@lattice-studio/tokens";
import type { Direction } from "@/contracts";

/** A drag starts after the pointer moves this many screen px (Flow 8: 4 px). */
export const DRAG_THRESHOLD = layoutSizes.dragThreshold;
/** Near the sheet's edge a drag scrolls the view, faster the deeper the pointer is in this zone (Flow 8: 48 px). */
export const EDGE_ZONE = layoutSizes.edgeZone;
/** Screen px per frame at the very edge (and beyond it). */
export const MAX_EDGE_SPEED = 20;

/** `value` on the `step` lattice through the origin. */
export function snap(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** A point snapped on both axes. */
export function snapPoint(point: Point, step: number): Point {
  return { x: snap(point.x, step), y: snap(point.y, step) };
}

function sizeOf(sizes: Sizes, name: string, metrics: LayoutMetrics): Size {
  return sizes[name] ?? { width: metrics.cardWidth, height: metrics.headerHeight + metrics.footerHeight };
}

/** A card's rectangle in sheet units, or null when it isn't placed. */
export function rectOf(layout: Layout, sizes: Sizes, name: string, metrics: LayoutMetrics): Rect | null {
  const entry = layout[name];
  if (!entry) return null;
  const size = sizeOf(sizes, name, metrics);
  return { x: entry.x, y: entry.y, width: size.width, height: size.height };
}

/** The bounding box of the named cards that are placed; null when none is. */
export function groupBounds(layout: Layout, sizes: Sizes, names: readonly string[], metrics: LayoutMetrics): Rect | null {
  let box: { x1: number; y1: number; x2: number; y2: number } | null = null;
  for (const name of names) {
    const r = rectOf(layout, sizes, name, metrics);
    if (!r) continue;
    box = box
      ? { x1: Math.min(box.x1, r.x), y1: Math.min(box.y1, r.y), x2: Math.max(box.x2, r.x + r.width), y2: Math.max(box.y2, r.y + r.height) }
      : { x1: r.x, y1: r.y, x2: r.x + r.width, y2: r.y + r.height };
  }
  return box ? { x: box.x1, y: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1 } : null;
}

/** Whether two rectangles overlap with area (cards that only touch edges don't). */
export function overlapping(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Whether two rectangles touch or overlap (a marquee "touches" a card, IR L49). */
export function touching(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

/** The layout without the named cards: what a moved group must not land on. */
export function without(layout: Layout, names: readonly string[]): Layout {
  const gone = new Set(names);
  const out: Layout = {};
  for (const [name, entry] of Object.entries(layout)) if (!gone.has(name)) out[name] = entry;
  return out;
}

/**
 * Where a group moved by `by` settles (Flow 8): where it was dropped, unless one of its cards lands on another
 * card; then the whole group slides to the nearest free slot for its bounding box, in a spiral from the drop
 * point (C9's `freeSlot`, contracts §3.4), keeping the cards' places relative to each other. Returns the
 * offset to apply.
 */
export function settledOffset(layout: Layout, sizes: Sizes, names: readonly string[], by: Point, metrics: LayoutMetrics): Point {
  const bounds = groupBounds(layout, sizes, names, metrics);
  if (!bounds || !landsOnCard(layout, sizes, names, by, metrics)) return by;
  const others = without(layout, names);
  const at = { x: bounds.x + by.x, y: bounds.y + by.y };
  const slot = freeSlot(others, sizes, at, { width: bounds.width, height: bounds.height }, metrics);
  return { x: slot.x - bounds.x, y: slot.y - bounds.y };
}

/** Whether any of `names`, moved by `by`, would overlap a card that isn't moving. */
export function landsOnCard(layout: Layout, sizes: Sizes, names: readonly string[], by: Point, metrics: LayoutMetrics): boolean {
  const others = without(layout, names);
  const obstacles = Object.keys(others).flatMap((name) => {
    const r = rectOf(others, sizes, name, metrics);
    return r ? [r] : [];
  });
  return names.some((name) => {
    const r = rectOf(layout, sizes, name, metrics);
    return r !== null && obstacles.some((o) => overlapping({ ...r, x: r.x + by.x, y: r.y + by.y }, o));
  });
}

/**
 * A nudge that never stacks cards (spec L425): `by`, or when that lands one of `names` on another card, the
 * next multiple of `by` that doesn't. Always an answer: past the last card that way is clear.
 */
export function clearStep(layout: Layout, sizes: Sizes, names: readonly string[], by: Point, metrics: LayoutMetrics): Point {
  if (by.x === 0 && by.y === 0) return by;
  for (let k = 1; ; k++) {
    const step = { x: by.x * k, y: by.y * k };
    if (!landsOnCard(layout, sizes, names, step, metrics)) return step;
  }
}

/** Cards a marquee `rect` (sheet units) touches, in layout order. */
export function marqueeHits(layout: Layout, sizes: Sizes, rect: Rect, metrics: LayoutMetrics): string[] {
  return Object.keys(layout).filter((name) => {
    const r = rectOf(layout, sizes, name, metrics);
    return r !== null && touching(rect, r);
  });
}

/** The rectangle spanned by two points. */
export function spanRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** `selection` with `name` added, or removed when it's there (Shift or ⌘/Ctrl click, IR L42). */
export function toggled(selection: readonly string[], name: string): string[] {
  return selection.includes(name) ? selection.filter((n) => n !== name) : [...selection, name];
}

/** `base` then every name of `extra` not in it. */
export function union(base: readonly string[], extra: readonly string[]): string[] {
  const seen = new Set(base);
  return [...base, ...extra.filter((name) => !seen.has(name))];
}

function center(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/**
 * The card nearest `from` in `dir` (IR L19), by centers: only cards whose center lies that way count, and a
 * card off to the side costs twice its sideways distance, so ⌘→ prefers the card in the same row over a closer
 * one below. Ties go to the name first in alphabetical order. Null when no card lies that way.
 */
export function nearestInDirection(
  layout: Layout,
  sizes: Sizes,
  from: string,
  dir: Direction,
  metrics: LayoutMetrics,
): string | null {
  const origin = rectOf(layout, sizes, from, metrics);
  if (!origin) return null;
  const o = center(origin);
  let best: { name: string; score: number } | null = null;
  for (const name of Object.keys(layout)) {
    if (name === from) continue;
    const r = rectOf(layout, sizes, name, metrics);
    if (!r) continue;
    const c = center(r);
    const dx = c.x - o.x;
    const dy = c.y - o.y;
    const along = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy;
    const across = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
    if (along <= 0) continue;
    const score = along + 2 * across;
    if (!best || score < best.score || (score === best.score && name < best.name)) best = { name, score };
  }
  return best?.name ?? null;
}

/** A unit step in `dir`, in sheet units. */
export function directionVector(dir: Direction, step: number): Point {
  switch (dir) {
    case "left": return { x: -step, y: 0 };
    case "right": return { x: step, y: 0 };
    case "up": return { x: 0, y: -step };
    case "down": return { x: 0, y: step };
  }
}

function axisSpeed(position: number, length: number, zone: number, max: number): number {
  if (length <= 2 * zone) return 0;
  if (position < zone) return (max * Math.min(zone, zone - position)) / zone;
  if (position > length - zone) return (-max * Math.min(zone, position - (length - zone))) / zone;
  return 0;
}

/**
 * How far to pan the view this frame while dragging (Flow 8), in screen px: zero away from the edges, rising
 * linearly through the 48 px edge zone to `max` at the edge and beyond it. Positive `dx` pans the view to show
 * what's left of it (the pointer is near the left edge). `pointer` is relative to the sheet's top-left corner.
 */
export function edgeScroll(pointer: Point, sheet: Size, zone = EDGE_ZONE, max = MAX_EDGE_SPEED): Point {
  return { x: axisSpeed(pointer.x, sheet.width, zone, max), y: axisSpeed(pointer.y, sheet.height, zone, max) };
}
