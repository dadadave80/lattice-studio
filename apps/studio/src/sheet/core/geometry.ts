/**
 * Where a card's trace to the core runs, in screen px: out of its ground glyph's stem to the gutter beside its
 * pin side, along the gutter to the ground rail (a horizontal line just above the core cell, spanning the sheet),
 * along the rail to the pad's column, and down into the pad. A selected card's routed rows each get a stub into
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
};

/** Two decimals: enough for a crisp line, and a stable `d` while nothing moves. */
function px(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The trace's paths for one card. The wire runs to the screen-space rail and pad, so it changes whenever the card
 * moves; the stubs and joints keep their shape and only follow the card, so they're given from the card's corner
 * and change with its size, pins, rows and the zoom only.
 */
export function tracePaths({ rect, side, transform, railY, pad, stubs }: TraceInput): TracePaths {
  const [tx, ty, zoom] = transform;
  const origin = { x: px(rect.x * zoom + tx), y: px(rect.y * zoom + ty) };
  // The card at its own origin, so the anchor and the gutter come out relative to its corner.
  const local = { x: 0, y: 0, width: rect.width, height: rect.height };
  const anchor = glyphAnchor(local, side);
  const edge = anchor.x * zoom;
  const lead = anchor.y * zoom + GLYPH_LEAD * glyphScale(zoom);
  const gutter = gutterX(local, side) * zoom;
  const line = `M${px(origin.x + edge)} ${px(origin.y + lead)}H${px(origin.x + gutter)}V${px(railY)}H${px(pad.x)}V${px(pad.y)}`;
  const ys = stubs.map((offset) => offset * zoom);
  const joints = ys.map((y) => ({ x: px(gutter), y: px(y) }));
  const top = ys.length ? Math.min(...ys) : null;
  const stubPath =
    top === null ? "" : `M${px(gutter)} ${px(top)}V${px(lead)}${ys.map((y) => `M${px(edge)} ${px(y)}H${px(gutter)}`).join("")}`;
  return { line, origin, stubs: stubPath, joints };
}
