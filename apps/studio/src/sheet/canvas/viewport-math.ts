/**
 * The sheet's viewport arithmetic (Flow 8, spec L480-L484), pure so it's tested without a browser. A viewport
 * is React Flow's `{ x, y, zoom }`: a sheet point `p` shows on screen at `p * zoom + (x, y)`, relative to the
 * sheet's top-left corner.
 */
import type { Point, Rect, Size } from "@lattice-studio/core";
import type { Viewport } from "@/contracts";

/** The zoom range, 10-200% (spec L480, L752). */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2;
/** Locate centers a card at this zoom or more (spec L483). */
export const LOCATE_ZOOM = 0.75;
/** Fit never zooms in past 100%, so a lone card doesn't fill the sheet. */
export const FIT_MAX_ZOOM = 1;
/** Screen px Fit and Zoom to selection leave around what they frame. */
export const FIT_PADDING = 48;
/** The stops + and − step through, so the readout always shows a round percentage. */
export const ZOOM_STOPS: readonly number[] = [0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];

const EPSILON = 1e-3;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** The next stop above (`1`) or below (`-1`) `zoom`; `zoom` itself at the end of the range. */
export function zoomStep(zoom: number, direction: 1 | -1): number {
  if (direction === 1) return ZOOM_STOPS.find((stop) => stop > zoom + EPSILON) ?? clampZoom(zoom);
  return [...ZOOM_STOPS].reverse().find((stop) => stop < zoom - EPSILON) ?? clampZoom(zoom);
}

/** "75%". */
export function percent(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

export function sameViewport(a: Viewport, b: Viewport): boolean {
  return Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.zoom - b.zoom) < EPSILON;
}

export function isViewport(value: unknown): value is Viewport {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return [v.x, v.y, v.zoom].every((n) => typeof n === "number" && Number.isFinite(n)) && (v.zoom as number) > 0;
}

/** `zoom` (clamped) with the screen point `at` staying where it is: + and − at the center, the wheel at the pointer. */
export function zoomAt(viewport: Viewport, zoom: number, at: Point): Viewport {
  const next = clampZoom(zoom);
  const sheet = { x: (at.x - viewport.x) / viewport.zoom, y: (at.y - viewport.y) / viewport.zoom };
  return { x: at.x - sheet.x * next, y: at.y - sheet.y * next, zoom: next };
}

/**
 * `viewport` with its zoom inside 10-200%, keeping what's at the center of a sheet of `size` in place. React
 * Flow's `setViewport` doesn't enforce the zoom range, so every viewport from storage or the session passes
 * through here before it's drawn.
 */
export function clampViewport(viewport: Viewport, size: Size): Viewport {
  const zoom = clampZoom(viewport.zoom);
  if (zoom === viewport.zoom) return viewport;
  if (!(viewport.zoom > 0)) return { x: viewport.x, y: viewport.y, zoom };
  return zoomAt(viewport, zoom, { x: size.width / 2, y: size.height / 2 });
}

/** The viewport that shows the sheet point `point` at the center of a sheet of `size`, at `zoom`. */
export function centerOn(point: Point, size: Size, zoom: number): Viewport {
  const z = clampZoom(zoom);
  return { x: size.width / 2 - point.x * z, y: size.height / 2 - point.y * z, zoom: z };
}

/** Screen px held by what floats over each edge of the sheet (the tool strip, the title block, the core cell). */
export type Insets = { top: number; right: number; bottom: number; left: number };

export type FitOptions = {
  /** The least room left on each side, in screen px. */
  padding?: number;
  maxZoom?: number;
  /** What floats over each edge: Fit frames into the sheet minus these, and `padding` where it's more. */
  insets?: Partial<Insets>;
};

/**
 * The viewport that frames `rect` (sheet units) in a sheet of `size`: into the room the insets leave, with at
 * least `padding` screen px on every side, centered in that room.
 */
export function fitRect(rect: Rect, size: Size, options: FitOptions = {}): Viewport {
  const padding = options.padding ?? FIT_PADDING;
  const side = (key: keyof Insets) => Math.max(padding, options.insets?.[key] ?? 0);
  const left = side("left");
  const top = side("top");
  const room = { width: Math.max(1, size.width - left - side("right")), height: Math.max(1, size.height - top - side("bottom")) };
  const fits = Math.min(room.width / Math.max(1, rect.width), room.height / Math.max(1, rect.height));
  const zoom = clampZoom(Math.min(fits, options.maxZoom ?? MAX_ZOOM));
  const center = { x: left + room.width / 2, y: top + room.height / 2 };
  return { x: center.x - (rect.x + rect.width / 2) * zoom, y: center.y - (rect.y + rect.height / 2) * zoom, zoom };
}

/**
 * `fitRect` into whichever of `layouts` (alternative insets: the room beside a float, or above it) frames `rect`
 * largest; the first on a tie. With none, the whole sheet.
 */
export function fitBest(rect: Rect, size: Size, layouts: readonly Partial<Insets>[], options: Omit<FitOptions, "insets"> = {}): Viewport {
  let best: Viewport | null = null;
  for (const insets of layouts) {
    const viewport = fitRect(rect, size, { ...options, insets });
    if (best === null || viewport.zoom > best.zoom + EPSILON) best = viewport;
  }
  return best ?? fitRect(rect, size, options);
}

/** Screen px between a framed card and what floats beside it. */
export const FLOAT_GAP = 16;

/** What floats over the sheet's edges, in px relative to its top-left corner (null while one doesn't show). */
export type SheetFloats = {
  /** The tool strip, at the left. */
  strip: Rect | null;
  /** The init order legend, at the right. */
  legend: Rect | null;
  /** The core cell and the title block, at the bottom right. */
  cell: Rect | null;
  title: Rect | null;
  /** The title block shows in full (its column runs beside the cards, not under them). */
  full: boolean;
  /** How far an open drawer covers the sheet from each side (the shell's sheet insets). */
  inset: { start: number; end: number };
  /** Screen px the ground rail runs above the higher of the cell's and the title block's tops. */
  railGap: number;
};

/**
 * The room Fit frames cards into (SH-02, CO-01): the room an open drawer leaves, minus the tool strip at its left,
 * the init order legend at its right while it shows, and at the bottom either
 * - the band under the ground rail (the higher of the core cell's and the title block's tops), so no core trace
 *   runs under a card, or
 * - the core cell's band alone, with the title block's column at the right while it's full, where a trace drops
 *   below the cards (CO-01).
 * Two layouts; `fitBest` takes the one that frames the cards larger. No float takes more than half the room either
 * way (the tool strip a quarter), but a drawer counts in full: it really covers the sheet. Beside a drawer, cards
 * keep `FIT_PADDING` from its edge.
 */
export function fitRoom(size: Size, floats: SheetFloats): Partial<Insets>[] {
  const { strip, legend, cell, title, full, inset, railGap } = floats;
  const room = Math.max(0, size.width - inset.start - inset.end);
  /** A side's inset: the drawer's, plus how far past its edge the floats there reach (at most `most`). */
  const side = (drawer: number, reach: number, most: number) =>
    drawer + Math.min(most, Math.max(reach - drawer, drawer > 0 ? FIT_PADDING : 0, 0));
  const fromRight = (box: Rect | null) => (box ? size.width - box.x + FLOAT_GAP : 0);
  const fromBottom = (top: number | null) => (top === null ? 0 : Math.min(size.height - top + FLOAT_GAP, size.height / 2));
  const left = side(inset.start, strip ? strip.x + strip.width + FLOAT_GAP : 0, room / 4);
  const legendRight = fromRight(legend);
  const tops = [cell?.y, title?.y].filter((y): y is number => y !== undefined);
  const railTop = tops.length ? Math.min(...tops) - railGap : null;
  const under = { left, right: side(inset.end, legendRight, room / 2), bottom: fromBottom(railTop) };
  if (!full || !title) return [under];
  const beside = {
    left,
    right: side(inset.end, Math.max(legendRight, fromRight(title)), room / 2),
    bottom: fromBottom(cell ? cell.y - railGap : null),
  };
  return [under, beside];
}

/** What a sheet of `size` shows at `viewport`, in sheet units. */
export function visibleRect(viewport: Viewport, size: Size): Rect {
  return {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: size.width / viewport.zoom,
    height: size.height / viewport.zoom,
  };
}

/** A sheet rect on screen, relative to the sheet's top-left corner. */
export function toScreen(rect: Rect, viewport: Viewport): Rect {
  return {
    x: rect.x * viewport.zoom + viewport.x,
    y: rect.y * viewport.zoom + viewport.y,
    width: rect.width * viewport.zoom,
    height: rect.height * viewport.zoom,
  };
}

/** The dot grid's pitch in sheet units: 8 (the snap grid), doubled until the dots sit at least 6 px apart on screen. */
export function gridGap(zoom: number, grid = 8): number {
  let gap = grid;
  while (gap * zoom < 6 && gap < grid * 64) gap *= 2;
  return gap;
}

/** Whether two rects share any area (touching edges don't count). */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function inset(rect: Rect, by: number): Rect {
  return { x: rect.x + by, y: rect.y + by, width: rect.width - 2 * by, height: rect.height - 2 * by };
}

function grow(rect: Rect, by: number): Rect {
  return inset(rect, -by);
}

function shift(rect: Rect, dx: number, dy: number): Rect {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}

/** How far `rect` has to move to lie inside `area`; a rect bigger than the area aligns its top-left corner. */
function into(rect: Rect, area: Rect): { dx: number; dy: number } {
  const axis = (start: number, length: number, areaStart: number, areaLength: number): number => {
    if (length >= areaLength || start < areaStart) return areaStart - start;
    const over = start + length - (areaStart + areaLength);
    return over > 0 ? -over : 0;
  };
  return { dx: axis(rect.x, rect.width, area.x, area.width), dy: axis(rect.y, rect.height, area.y, area.height) };
}

function inside(rect: Rect, area: Rect): boolean {
  return (
    rect.x >= area.x - EPSILON &&
    rect.y >= area.y - EPSILON &&
    rect.x + rect.width <= area.x + area.width + EPSILON &&
    rect.y + rect.height <= area.y + area.height + EPSILON
  );
}

/**
 * How far to move `target` (screen px) so it lies inside `area` and clear of every rect in `floats`, `margin`
 * px from each (WCAG 2.4.11: a focused card is never hidden by what floats over the sheet, spec L771). A float
 * the card can't clear without leaving the area is left alone; `{ dx: 0, dy: 0 }` means it's already clear.
 */
export function clearOf(target: Rect, area: Rect, floats: readonly Rect[], margin: number): { dx: number; dy: number } {
  const room = inset(area, margin);
  const first = into(target, room);
  let dx = first.dx;
  let dy = first.dy;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const float of floats) {
      const current = shift(target, dx, dy);
      const blocked = grow(float, margin);
      if (!intersects(current, blocked)) continue;
      const options = [
        { dx: blocked.x - (current.x + current.width), dy: 0 },
        { dx: blocked.x + blocked.width - current.x, dy: 0 },
        { dx: 0, dy: blocked.y - (current.y + current.height) },
        { dx: 0, dy: blocked.y + blocked.height - current.y },
      ]
        .filter((o) => inside(shift(current, o.dx, o.dy), room))
        .sort((a, b) => Math.abs(a.dx) + Math.abs(a.dy) - (Math.abs(b.dx) + Math.abs(b.dy)));
      const best = options[0];
      if (!best) continue;
      dx += best.dx;
      dy += best.dy;
      moved = true;
    }
    if (!moved) break;
  }
  return { dx: Math.round(dx), dy: Math.round(dy) };
}
