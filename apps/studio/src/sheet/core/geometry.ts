/**
 * Where a card's trace to the core runs, in screen px: out of its ground glyph's stem to the gutter beside its
 * pin side, along the gutter to the ground rail (a horizontal line just above the core cell, spanning the sheet),
 * along the rail to the pad's column, and down into the pad. Where another card lies across its run on the rail,
 * the run drops below it while it can stay above the cell; a crossing it can't avoid is bridged. A selected card's routed rows each get a stub into
 * the gutter, so the wire visibly is its selectors. Pure: card rects in sheet units × React Flow's transform, the
 * rail's y and the pad's point in screen px. Every length matches `CardGround.module.css` and `CardHandles`.
 */
import type { Hex4, LayoutMetrics, Point, Rect } from "@lattice-studio/core";

/** Sheet units outside a card's pin side where its trace runs up and down (tidy leaves 72 between columns). */
export const GUTTER = 20;
/** Screen px between the ground rail and the core cell's top edge. */
export const RAIL_GAP = 12;
/** The glyph's stem is 9 px tall on screen; a trace leaves it halfway down. */
export const GLYPH_LEAD = 4.5;
/** A junction dot's radius on a live trace, in screen px. */
export const JOINT_RADIUS = 2.5;

/** React Flow's transform: `[x, y, zoom]`. */
export type Transform = readonly [x: number, y: number, zoom: number];
export type PinSide = "left" | "right";

/** The glyph's scale on screen: 1 down to 50% zoom, then shrinking with the sheet (`CardGround.module.css`). */
export function glyphScale(zoom: number): number {
  return Math.min(1, 2 * zoom);
}

/** The corner the glyph hangs from: the card's pin-side bottom corner, in sheet units. */
export function glyphAnchor(rect: Rect, side: PinSide): Point {
  return { x: side === "right" ? rect.x + rect.width : rect.x, y: rect.y + rect.height };
}

/** The x a card's trace runs along, just outside its pin side, in sheet units. */
export function gutterX(rect: Rect, side: PinSide): number {
  return side === "right" ? rect.x + rect.width + GUTTER : rect.x - GUTTER;
}

/**
 * Where a card's routed rows leave it: each drawn row's middle, as `CardHandles` places its handle, measured from
 * the card's top in sheet units. A compact card draws no rows, so it gets no stubs.
 */
export function stubOffsets(rows: readonly Hex4[], routed: ReadonlySet<Hex4>, compact: boolean, metrics: LayoutMetrics): number[] {
  if (compact) return [];
  return rows.flatMap((selector, index) =>
    routed.has(selector) ? [metrics.headerHeight + metrics.grid + index * metrics.rowHeight + metrics.rowHeight / 2] : [],
  );
}

export type TraceInput = {
  /** The card, in sheet units. */
  rect: Rect;
  side: PinSide;
  transform: Transform;
  /** The ground rail's y, in screen px. */
  railY: number;
  /** The pad the trace ends on (its top center), in screen px. */
  pad: Point;
  /** `stubOffsets`, for a live trace; empty otherwise. */
  stubs: readonly number[];
  /** Every other card, in screen px: the run drops below them, or bridges them where it can't. */
  obstacles?: readonly Rect[];
  /** The lowest the run may drop to, in screen px: just above the cell. `railY` when omitted. */
  floorY?: number;
  /** The title block's left edge, in screen px: a run reaching its column keeps to the rail, above the block. */
  titleLeft?: number | null;
};

export type TracePaths = {
  /** The wire, in screen px: glyph, gutter, rail, pad. */
  line: string;
  /** The card's top-left corner on screen: the stubs and joints are drawn from it, so a drag only moves them. */
  origin: Point;
  /** The stubs and the gutter run above the glyph's lead, from `origin`; empty without stubs. */
  stubs: string;
  /** Where each stub meets the gutter, from `origin`. */
  joints: Point[];
  /** The stretches of the wire over another card, in screen px, drawn over it on a casing; empty when none. */
  bridges: string;
};

/** Two decimals: enough for a crisp line, and a stable `d` while nothing moves. */
function px(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Whether `rect` lies across the horizontal line `y` between `lo` and `hi` (touching edges don't count). */
function across(rect: Rect, y: number, lo: number, hi: number): boolean {
  return rect.x < hi && rect.x + rect.width > lo && rect.y < y && rect.y + rect.height > y;
}

/**
 * The y of a wire's run along the rail between `from` and `to`, in screen px: the rail while no card lies across
 * it there; else just below the lowest card in the way (and any it then meets), while that stays at or above
 * `floor`. A run that reaches the title block's column (`titleLeft`) keeps to the rail, so it never runs behind
 * the block. When no drop clears every card, the rail: the crossing is bridged (`crossings`).
 */
export function runY(from: number, to: number, rail: number, floor: number, obstacles: readonly Rect[], titleLeft: number | null): number {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const deepest = titleLeft !== null && hi >= titleLeft ? rail : floor;
  let y = rail;
  for (let pass = 0; pass <= obstacles.length; pass++) {
    const blocking = obstacles.filter((rect) => across(rect, y, lo, hi));
    if (blocking.length === 0) return y;
    y = Math.max(...blocking.map((rect) => rect.y + rect.height)) + RAIL_GAP;
    if (y > deepest) return rail;
  }
  return rail;
}

/**
 * The stretches of an axis-aligned polyline (screen px) that pass over any of `obstacles`, as one path. Where a
 * wire has to cross a card, these draw over the card on a casing in the ground's colour, so the wire bridges the
 * card instead of seeming to plug into it. Empty when the wire crosses nothing.
 */
export function crossings(points: readonly Point[], obstacles: readonly Rect[]): string {
  let d = "";
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) continue;
    for (const rect of obstacles) {
      if (a.y === b.y && rect.y < a.y && rect.y + rect.height > a.y) {
        const lo = Math.max(Math.min(a.x, b.x), rect.x);
        const hi = Math.min(Math.max(a.x, b.x), rect.x + rect.width);
        if (hi > lo) d += `M${px(lo)} ${px(a.y)}H${px(hi)}`;
      } else if (a.x === b.x && a.y !== b.y && rect.x < a.x && rect.x + rect.width > a.x) {
        const lo = Math.max(Math.min(a.y, b.y), rect.y);
        const hi = Math.min(Math.max(a.y, b.y), rect.y + rect.height);
        if (hi > lo) d += `M${px(a.x)} ${px(lo)}V${px(hi)}`;
      }
    }
  }
  return d;
}

/**
 * The trace's paths for one card. The wire runs to the screen-space rail and pad, so it changes whenever the card
 * moves; the stubs and joints keep their shape and only follow the card, so they're given from the card's corner
 * and change with its size, pins, rows and the zoom only.
 */
export function tracePaths({ rect, side, transform, railY, pad, stubs, obstacles = [], floorY, titleLeft = null }: TraceInput): TracePaths {
  const [tx, ty, zoom] = transform;
  const origin = { x: px(rect.x * zoom + tx), y: px(rect.y * zoom + ty) };
  // The card at its own origin, so the anchor and the gutter come out relative to its corner.
  const local = { x: 0, y: 0, width: rect.width, height: rect.height };
  const anchor = glyphAnchor(local, side);
  const edge = anchor.x * zoom;
  const lead = anchor.y * zoom + GLYPH_LEAD * glyphScale(zoom);
  const gutter = gutterX(local, side) * zoom;
  const start = { x: px(origin.x + edge), y: px(origin.y + lead) };
  const run = px(origin.x + gutter);
  const end = { x: px(pad.x), y: px(pad.y) };
  const rail = px(runY(run, end.x, railY, floorY ?? railY, obstacles, titleLeft));
  const line = `M${start.x} ${start.y}H${run}V${rail}H${end.x}V${end.y}`;
  const points = [start, { x: run, y: start.y }, { x: run, y: rail }, { x: end.x, y: rail }, end];
  const ys = stubs.map((offset) => offset * zoom);
  const joints = ys.map((y) => ({ x: px(gutter), y: px(y) }));
  const top = ys.length ? Math.min(...ys) : null;
  const stubPath =
    top === null ? "" : `M${px(gutter)} ${px(top)}V${px(lead)}${ys.map((y) => `M${px(edge)} ${px(y)}H${px(gutter)}`).join("")}`;
  return { line, origin, stubs: stubPath, joints, bridges: crossings(points, obstacles) };
}
