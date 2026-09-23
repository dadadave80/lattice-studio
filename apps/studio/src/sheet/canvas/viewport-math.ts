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

/** The viewport that shows the sheet point `point` at the center of a sheet of `size`, at `zoom`. */
export function centerOn(point: Point, size: Size, zoom: number): Viewport {
  const z = clampZoom(zoom);
  return { x: size.width / 2 - point.x * z, y: size.height / 2 - point.y * z, zoom: z };
}

/** The viewport that frames `rect` (sheet units) in a sheet of `size`, `padding` screen px around it. */
export function fitRect(rect: Rect, size: Size, options: { padding?: number; maxZoom?: number } = {}): Viewport {
  const padding = options.padding ?? FIT_PADDING;
  const room = { width: Math.max(1, size.width - 2 * padding), height: Math.max(1, size.height - 2 * padding) };
  const fits = Math.min(room.width / Math.max(1, rect.width), room.height / Math.max(1, rect.height));
  const zoom = clampZoom(Math.min(fits, options.maxZoom ?? MAX_ZOOM));
  return centerOn({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, size, zoom);
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
