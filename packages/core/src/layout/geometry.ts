/**
 * Shared geometry for the layout module: rectangles, snapping, the nearest-free-spot search and orthogonal
 * routing. Internal: `index.ts` doesn't re-export it, so it never widens core's public API.
 */
import type { Layout, LayoutMetrics, Point, Rect, Size, Sizes } from "../model/layout";

/** Nearest multiple of `step` (half-way rounds up; never -0). */
export function snap(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step || 0 : value;
}

/** The smallest multiple of `step` at or above `value`. */
export function snapUp(value: number, step: number): number {
  return step > 0 ? Math.ceil(value / step - 1e-9) * step || 0 : value;
}

/** The largest multiple of `step` at or below `value`. */
export function snapDown(value: number, step: number): number {
  return step > 0 ? Math.floor(value / step + 1e-9) * step || 0 : value;
}

/** The size layout assumes for a card `sizes` doesn't list: a card with no rows. */
export function fallbackSize(metrics: LayoutMetrics): Size {
  return { width: metrics.cardWidth, height: metrics.headerHeight + metrics.footerHeight };
}

export function sizeOf(sizes: Sizes, name: string, metrics: LayoutMetrics): Size {
  return sizes[name] ?? fallbackSize(metrics);
}

/** The card's rectangle, or null when it isn't on the sheet. */
export function rectOf(layout: Layout, sizes: Sizes, name: string, metrics: LayoutMetrics): Rect | null {
  const entry = layout[name];
  if (!entry) return null;
  const size = sizeOf(sizes, name, metrics);
  return { x: entry.x, y: entry.y, width: size.width, height: size.height };
}

/** Every card on the sheet, in name order (so iteration never depends on insertion order). */
export function cardRects(layout: Layout, sizes: Sizes, metrics: LayoutMetrics): { name: string; rect: Rect }[] {
  return Object.keys(layout)
    .sort(compareText)
    .flatMap((name) => {
      const rect = rectOf(layout, sizes, name, metrics);
      return rect ? [{ name, rect }] : [];
    });
}

/** Interiors intersect, with `pad` of clearance required. Edges that only touch don't overlap. */
export function overlaps(a: Rect, b: Rect, pad = 0): boolean {
  return (
    a.x < b.x + b.width + pad && a.x + a.width + pad > b.x && a.y < b.y + b.height + pad && a.y + a.height + pad > b.y
  );
}

/** The bounding box of `rects`, or null when there are none. */
export function unionRect(rects: readonly Rect[]): Rect | null {
  const first = rects[0];
  if (!first) return null;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x + first.width;
  let maxY = first.y + first.height;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function center(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** The point of `r` (edge or inside) closest to `p`. */
export function nearestOn(p: Point, r: Rect): Point {
  return {
    x: Math.max(r.x, Math.min(p.x, r.x + r.width)),
    y: Math.max(r.y, Math.min(p.y, r.y + r.height)),
  };
}

/** Code-unit order: deterministic and locale-free. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The free top-left point nearest `at` (Euclidean, on the `step` lattice through the origin) for a box of
 * `size` that overlaps none of `obstacles` (with `pad` clearance). Equivalent to walking a spiral out from
 * `at` in `step` increments and taking the first free spot, but exact and fast: the nearest free point either
 * is `at` (snapped) or, on each axis, sits flush against some obstacle's far edge, so only those coordinates
 * are candidates. Ties break by y, then x. There is always an answer (right of every obstacle is free).
 *
 * The search goes column by column, nearest column first, and stops once a column is farther away than the best
 * free point found: each column checks only the obstacles in its band, and most columns stop at their first
 * free row. The answer is the one the full candidate grid sorted by (distance, y, x) would give.
 */
export function nearestFree(obstacles: readonly Rect[], at: Point, size: Size, step: number, pad = 0): Point {
  const start = { x: snap(at.x, step), y: snap(at.y, step) };
  const clear = (p: Point, among: readonly Rect[]): boolean => {
    const box = { x: p.x, y: p.y, width: size.width, height: size.height };
    for (const o of among) if (overlaps(box, o, pad)) return false;
    return true;
  };
  if (clear(start, obstacles)) return start;
  const xs = new Set<number>([start.x]);
  const ys = new Set<number>([start.y]);
  for (const o of obstacles) {
    xs.add(snapUp(o.x + o.width + pad, step));
    xs.add(snapDown(o.x - pad - size.width, step));
    ys.add(snapUp(o.y + o.height + pad, step));
    ys.add(snapDown(o.y - pad - size.height, step));
  }
  const byDistance = (values: Iterable<number>, origin: number): { v: number; d: number }[] =>
    [...values].map((v) => ({ v, d: (v - origin) * (v - origin) })).sort((a, b) => a.d - b.d || a.v - b.v);
  const columns = byDistance(xs, at.x);
  const rows = byDistance(ys, at.y);
  let best: { x: number; y: number; d: number } | null = null;
  for (const column of columns) {
    if (best && column.d > best.d) break;
    const x = column.v;
    // Only obstacles overlapping this column's band can block a point in it.
    const band = obstacles.filter((o) => x < o.x + o.width + pad && x + size.width + pad > o.x);
    for (const row of rows) {
      const d = column.d + row.d;
      if (best && (d > best.d || (d === best.d && (row.v > best.y || (row.v === best.y && x > best.x))))) break;
      if (!clear({ x, y: row.v }, band)) continue;
      best = { x, y: row.v, d };
      break;
    }
  }
  if (best) return { x: best.x, y: best.y };
  // Unreachable: the point right of every obstacle at `start.y` is a candidate and free.
  const right = Math.max(...obstacles.map((o) => o.x + o.width + pad));
  return { x: snapUp(right, step), y: start.y };
}

/** Drops repeated points and the middle of straight runs. */
export function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const prev = out[out.length - 2];
    if (last && prev && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) {
      out[out.length - 1] = { x: p.x, y: p.y };
      continue;
    }
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** The midpoint of the path's longest segment: where a label sits. */
export function routeMid(points: readonly Point[]): Point {
  let best = points[0] ?? { x: 0, y: 0 };
  let longest = -1;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1];
    const q = points[i];
    if (!p || !q) continue;
    const length = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
    if (length > longest) {
      longest = length;
      best = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    }
  }
  return best;
}

/** An edge anchor: a point on a card's left or right side, and the side it leaves from. */
export type Anchor = Point & { side: "left" | "right" };

/** True when no segment of the path crosses a rectangle's interior (1 unit of slack at its edges). */
export function clearOf(points: readonly Point[], rects: readonly Rect[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1];
    const q = points[i];
    if (!p || !q) continue;
    const sx = Math.min(p.x, q.x);
    const sy = Math.min(p.y, q.y);
    const sw = Math.abs(q.x - p.x);
    const sh = Math.abs(q.y - p.y);
    for (const r of rects) {
      if (sx < r.x + r.width - 1 && sx + sw > r.x + 1 && sy < r.y + r.height - 1 && sy + sh > r.y + 1) return false;
    }
  }
  return true;
}

/**
 * An orthogonal path between two edge anchors. Each end leaves its side by a stub (plus `lane` offsets so
 * parallel paths don't coincide); when the direct path crosses a card in `obstacles`, it detours above or
 * below the cards in its way, nearest level first. Constants are in grid units (stub 3, lane 3/4).
 */
export function orthoRoute(a: Anchor, b: Anchor, lane: number, obstacles: readonly Rect[], grid: number): Point[] {
  const stub = 3 * grid;
  const off = lane * (grid * 3) / 4;
  const da = a.side === "right" ? 1 : -1;
  const db = b.side === "right" ? 1 : -1;
  const ax = a.x + da * (stub + off);
  const bx = b.x + db * (stub + off);
  let direct: Point[];
  if (a.side === b.side) {
    const x = a.side === "right" ? Math.max(ax, bx) : Math.min(ax, bx);
    direct = [a, { x, y: a.y }, { x, y: b.y }, b];
  } else if (a.side === "right" ? ax <= bx : ax >= bx) {
    const mx = snap((ax + bx) / 2, grid) + off;
    direct = [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  } else {
    const my = snap((a.y + b.y) / 2, grid);
    direct = [a, { x: ax, y: a.y }, { x: ax, y: my }, { x: bx, y: my }, { x: bx, y: b.y }, b];
  }
  const plain = (points: Point[]): Point[] => simplify(points.map((p) => ({ x: p.x, y: p.y })));
  if (clearOf(direct, obstacles)) return plain(direct);
  const lo = Math.min(ax, bx);
  const hi = Math.max(ax, bx);
  const mid = (a.y + b.y) / 2;
  const levels: number[] = [];
  for (const o of obstacles) {
    if (o.x < hi && o.x + o.width > lo) levels.push(o.y - stub - off, o.y + o.height + stub + off);
  }
  levels.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid) || p - q);
  for (const y of levels) {
    const detour = [a, { x: ax, y: a.y }, { x: ax, y }, { x: bx, y }, { x: bx, y: b.y }, b];
    if (clearOf(detour, obstacles)) return plain(detour);
  }
  return plain(direct);
}
