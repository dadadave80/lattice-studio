/**
 * The sheet's view, for commands and the modules built beside the canvas (S4c, S4d, S4e). The viewport
 * belongs to the project (spec L402, PA L14): it lives in the session per project id and is saved through
 * `saveViewport`, and the mounted sheet follows it. Every function here works with or without a mounted
 * sheet: without one, it moves the stored viewport, and the sheet opens there.
 *
 * - `ensureVisible(facet)`: pans a card clear of everything floating over the sheet (2.4.11, spec L771). The
 *   sheet calls it itself when a card takes keyboard focus; S4e calls it before focusing a card it moves to.
 * - `panToPlaced(facet)`: after a placement, pans only if the new card would be off-screen (spec L426).
 * - `locateCard(facet, selector?)`: selects the card and centers it (or its pin) at 75% zoom or more.
 * - `fitCards(names?)`, `zoomSheet(zoom, at?)`, `panSheet(dx, dy)`, `moveViewport(viewport)`: the moves the
 *   commands make; each glides, or jumps with reduced motion.
 * - `sheetViewport()`, `sheetSize()`: what the view shows now.
 *
 * Auto-pan keeps focused cards clear of React Flow's `Panel`s (tool strip, zoom readout, title block, minimap,
 * Back to content), of anything else marked `data-sheet-float`, and of drawers, toasts and the console,
 * found by their regions.
 */
import type { Hex4, Point, Rect, Size } from "@lattice-studio/core";
import { doc, getAnalysis, getCatalog, saveViewport, session, type Viewport } from "@/contracts";
import { reducedMotion } from "@/a11y/preferences";
import { RAIL_GAP } from "@/sheet/core/geometry";
import { cardRect, cardSizes, cardsBounds } from "./geometry";
import {
  centerOn, clampZoom, clearOf, FIT_MAX_ZOOM, fitBest, intersects, LOCATE_ZOOM, MAX_ZOOM, toScreen, zoomAt, type Insets,
} from "./viewport-math";

/** The attribute a floating element over the sheet carries, so auto-pan keeps focused cards clear of it. */
export const SHEET_FLOAT_ATTRIBUTE = "data-sheet-float";

/** How long a viewport move glides; reduced motion jumps. */
export const GLIDE_MS = 200;
/** Screen px auto-pan leaves between a focused card and the edge or a floating element. */
export const CLEAR_MARGIN = 16;

/** What the mounted sheet gives the view (Sheet.tsx attaches it). */
export type SheetHandle = {
  viewport(): Viewport;
  /** The sheet's size in px; zero while it's hidden (a pane switcher tab, `display: none`). */
  size(): Size;
  element(): HTMLElement | null;
  /** Moves React Flow's viewport, gliding for `duration` ms; `stored` false keeps its move end out of the session. */
  setViewport(viewport: Viewport, duration: number, stored: boolean): void;
  /** How far below its card's top a pin row's center sits, when React Flow has measured the row. */
  pinY(facet: string, selector: Hex4): number | null;
};

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };
/** The title bar and the console header, in px, for estimating the sheet's size with no sheet mounted. */
const CHROME_HEIGHT = 40 + 36;

const handles: SheetHandle[] = [];
let lastSize: Size | null = null;

/** The sheet registers itself while mounted. Returns a disposer. */
export function attachSheet(handle: SheetHandle): () => void {
  handles.push(handle);
  return () => {
    const at = handles.lastIndexOf(handle);
    if (at >= 0) handles.splice(at, 1);
  };
}

function mounted(): SheetHandle | null {
  return handles.at(-1) ?? null;
}

/** Whether a sheet is mounted now. */
export function sheetMounted(): boolean {
  return mounted() !== null;
}

/** The open project's viewport now: the live one while the sheet is mounted, else the stored one. */
export function sheetViewport(): Viewport {
  const handle = mounted();
  if (handle) return handle.viewport();
  return session.get().viewports[doc.get().id] ?? DEFAULT_VIEWPORT;
}

/** The sheet's size in px: measured while it shows, else the last size it had, else estimated from the window. */
export function sheetSize(): Size {
  const measured = mounted()?.size();
  if (measured && measured.width > 0 && measured.height > 0) {
    lastSize = measured;
    return measured;
  }
  if (lastSize) return lastSize;
  const { panes } = session.get();
  const width = window.innerWidth - (panes.left.open ? panes.left.size : 0) - (panes.inspector.open ? panes.inspector.size : 0);
  const height = window.innerHeight - CHROME_HEIGHT - (panes.console.open ? panes.console.size : 0);
  return { width: Math.max(320, width), height: Math.max(240, height) };
}

/** Stores the open project's viewport: in the session, and saved per project (S7a). */
export function storeViewport(projectId: string, viewport: Viewport): void {
  const current = session.get().viewports[projectId];
  if (!current || current.x !== viewport.x || current.y !== viewport.y || current.zoom !== viewport.zoom) {
    session.set((s) => ({ viewports: { ...s.viewports, [projectId]: viewport } }));
  }
  saveViewport(projectId, viewport);
}

export type MoveOptions = {
  /** False jumps even with full motion. */
  animate?: boolean;
  /**
   * False moves the mounted sheet without writing the session or saving, and jumps: for moves made every frame
   * (S4e's edge auto-scroll), which call `storeSheetViewport()` once when they end. Without a mounted sheet
   * nothing moves.
   */
  store?: boolean;
};

/** Moves the view: glides on the mounted sheet (jumps with reduced motion) and stores the result. */
export function moveViewport(viewport: Viewport, options: MoveOptions = {}): Viewport {
  const next = { x: viewport.x, y: viewport.y, zoom: clampZoom(viewport.zoom) };
  const store = options.store !== false;
  const handle = mounted();
  if (handle) handle.setViewport(next, options.animate === false || !store || reducedMotion() ? 0 : GLIDE_MS, store);
  if (store) storeViewport(doc.get().id, next);
  return next;
}

/** Stores the view as it is now: the end of a run of `store: false` moves. */
export function storeSheetViewport(): Viewport {
  const now = sheetViewport();
  storeViewport(doc.get().id, now);
  return now;
}

function sizes() {
  return cardSizes(doc.get().layout, getCatalog(), getAnalysis());
}

/** Screen px between a framed card and what floats beside it. */
const FLOAT_GAP = 16;

/** A float's box relative to the sheet's top-left corner, while it shows. */
function floatBox(sheet: HTMLElement, selector: string): Rect | null {
  const el = sheet.querySelector<HTMLElement>(selector);
  if (!el || el.getClientRects().length === 0) return null;
  const box = sheet.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return { x: r.left - box.left, y: r.top - box.top, width: r.width, height: r.height };
}

/**
 * The room Fit, Zoom to selection and a project's first view frame cards into (SH-02, CO-01): the sheet minus the
 * tool strip at the left, the init order legend at the right while it shows, and at the bottom either
 * - the band under the ground rail (the higher of the core cell's and the title block's tops), so no core trace
 *   runs under a card, or
 * - the core cell's band alone, with the title block's column at the right while it's full, where a trace drops
 *   below the cards (CO-01).
 * Two layouts; `fitBest` takes the one that frames the cards larger. Neither floats nor this leave less than half
 * the sheet either way. Empty with no sheet mounted: the whole sheet.
 */
export function fitLayouts(size: Size = sheetSize()): Partial<Insets>[] {
  const sheet = mounted()?.element();
  if (!sheet) return [];
  const strip = floatBox(sheet, '[data-chrome="tool-strip"]');
  const legend = floatBox(sheet, '[data-chrome="init-legend"]');
  const cell = floatBox(sheet, '[data-chrome="core-cell"]');
  const title = floatBox(sheet, '[data-chrome="title-block"]');
  const full = sheet.querySelector('[data-chrome="title-block"][data-form="full"]') !== null;
  const left = Math.min(size.width / 4, strip ? strip.x + strip.width + FLOAT_GAP : 0);
  const fromRight = (box: Rect | null) => (box ? size.width - box.x + FLOAT_GAP : 0);
  const fromBottom = (top: number | null) => (top === null ? 0 : size.height - top + FLOAT_GAP);
  const cap = (n: number, of: number) => Math.min(n, of / 2);
  const legendRight = fromRight(legend);
  const tops = [cell?.y, title?.y].filter((y): y is number => y !== undefined);
  const railTop = tops.length ? Math.min(...tops) - RAIL_GAP : null;
  const under = { left, right: cap(legendRight, size.width), bottom: cap(fromBottom(railTop), size.height) };
  if (!full || !title) return [under];
  const beside = {
    left,
    right: cap(Math.max(legendRight, fromRight(title)), size.width),
    bottom: cap(fromBottom(cell ? cell.y - RAIL_GAP : null), size.height),
  };
  return [under, beside];
}

/** The viewport that frames `bounds` (sheet units) in the room the floats leave (`fitLayouts`). */
export function fitInRoom(bounds: Rect, maxZoom: number, size: Size = sheetSize()): Viewport {
  return fitBest(bounds, size, fitLayouts(size), { maxZoom });
}

/** Frames `names` (every card when omitted), up to 100% for Fit and 200% for a selection. Null when none is placed. */
export function fitCards(names?: readonly string[]): Viewport | null {
  const layout = doc.get().layout;
  const bounds = cardsBounds(layout, sizes(), names);
  if (!bounds) return null;
  return moveViewport(fitInRoom(bounds, names ? MAX_ZOOM : FIT_MAX_ZOOM));
}

/** Zooms to `zoom` (clamped) at a screen point, the sheet's center by default. */
export function zoomSheet(zoom: number, at?: Point): Viewport {
  const size = sheetSize();
  return moveViewport(zoomAt(sheetViewport(), zoom, at ?? { x: size.width / 2, y: size.height / 2 }));
}

/** Pans by screen px. `store: false` for per-frame panning, then `storeSheetViewport()` once at the end. */
export function panSheet(dx: number, dy: number, options: MoveOptions = {}): Viewport {
  const v = sheetViewport();
  return moveViewport({ x: v.x + dx, y: v.y + dy, zoom: v.zoom }, options);
}

/**
 * Selects `facet` and centers it, or its pin row when `selector` is drawn, at 75% zoom or more (spec L483).
 * False when the card isn't placed.
 */
export function locateCard(facet: string, selector?: Hex4): boolean {
  const layout = doc.get().layout;
  const rect = cardRect(layout, sizes(), facet);
  if (!rect) return false;
  session.set({ selection: [facet] });
  const pinY = selector ? (mounted()?.pinY(facet, selector) ?? null) : null;
  const point = { x: rect.x + rect.width / 2, y: rect.y + (pinY ?? rect.height / 2) };
  const zoom = Math.max(sheetViewport().zoom, LOCATE_ZOOM);
  moveViewport(centerOn(point, sheetSize(), zoom));
  return true;
}

/** Whether any part of `facet`'s card shows in the sheet now. */
export function cardInView(facet: string): boolean {
  const rect = cardRect(doc.get().layout, sizes(), facet);
  if (!rect) return false;
  const size = sheetSize();
  return intersects(toScreen(rect, sheetViewport()), { x: 0, y: 0, width: size.width, height: size.height });
}

function visible(el: Element): boolean {
  return el instanceof HTMLElement && !el.hidden && el.getClientRects().length > 0;
}

/** Everything floating over the sheet, as rects relative to the sheet's top-left corner. */
export function floatingRects(sheet: HTMLElement): Rect[] {
  const box = sheet.getBoundingClientRect();
  const candidates = [
    ...sheet.querySelectorAll(".react-flow__panel"),
    ...document.querySelectorAll(`[${SHEET_FLOAT_ATTRIBUTE}]`),
    ...document.querySelectorAll('[data-region="left"], [data-region="inspector"], [data-region="console"]'),
    ...document.querySelectorAll('[data-region="toasts"] > *'),
  ];
  const rects: Rect[] = [];
  for (const el of candidates) {
    if (!visible(el) || el.contains(sheet)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const rect = { x: r.left - box.left, y: r.top - box.top, width: r.width, height: r.height };
    const overlaps = rect.x < box.width && rect.x + rect.width > 0 && rect.y < box.height && rect.y + rect.height > 0;
    if (overlaps) rects.push(rect);
  }
  return rects;
}

function shiftRect(rect: Rect, dx: number, dy: number): Rect {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}

/** Whether `rect` lies inside `area` (within a rounding error). */
function withinArea(rect: Rect, area: Rect): boolean {
  const epsilon = 1e-3;
  return (
    rect.x >= area.x - epsilon &&
    rect.y >= area.y - epsilon &&
    rect.x + rect.width <= area.x + area.width + epsilon &&
    rect.y + rect.height <= area.y + area.height + epsilon
  );
}

/** `floats` grown by `margin`, so a rect that avoids all of them sits `margin` clear of the real ones. */
function grownFloats(floats: readonly Rect[], margin: number): Rect[] {
  return floats.map((f) => ({ x: f.x - margin, y: f.y - margin, width: f.width + 2 * margin, height: f.height + 2 * margin }));
}

/** Every grown float `rect` still overlaps. */
function blocking(rect: Rect, grown: readonly Rect[]): Rect[] {
  return grown.filter((f) => intersects(rect, f));
}

const DIRECTIONS = ["left", "right", "up", "down"] as const;
type Direction = (typeof DIRECTIONS)[number];

/** How far `rect` has to move `dir` to clear every float in `blockers` at once. */
function pushNeeded(rect: Rect, blockers: readonly Rect[], dir: Direction): number {
  let need = 0;
  for (const f of blockers) {
    if (dir === "left") need = Math.max(need, rect.x + rect.width - f.x);
    else if (dir === "right") need = Math.max(need, f.x + f.width - rect.x);
    else if (dir === "up") need = Math.max(need, rect.y + rect.height - f.y);
    else need = Math.max(need, f.y + f.height - rect.y);
  }
  return need;
}

function pushed(rect: Rect, dir: Direction, need: number): Rect {
  if (dir === "left") return shiftRect(rect, -need, 0);
  if (dir === "right") return shiftRect(rect, need, 0);
  if (dir === "up") return shiftRect(rect, 0, -need);
  return shiftRect(rect, 0, need);
}

/** Total px² `rect` overlaps every float in `floats`, at their real size (no margin): the letter of 2.4.11. */
function overlapPx(rect: Rect, floats: readonly Rect[]): number {
  let total = 0;
  for (const f of floats) {
    const w = Math.min(rect.x + rect.width, f.x + f.width) - Math.max(rect.x, f.x);
    const h = Math.min(rect.y + rect.height, f.y + f.height) - Math.max(rect.y, f.y);
    if (w > 0 && h > 0) total += w * h;
  }
  return total;
}

/**
 * `clearOf` clears one float at a time by whichever direction moves it least (spec L771, 2.4.11), which can
 * walk a card into a *second* float its first move never crossed, then back again: each fix is locally
 * shortest but neither considers the other, and after its four passes the card can still be covered (the
 * Panel `floatingRects` lists, not cleared, spec L771). This starts from `clearOf`'s move and, while any float
 * still covers the card at `margin`, finds whichever single direction clears every float still covering it at
 * once (grown by `margin`) — never only the one that was checked last — and takes the shortest one that lands
 * inside the sheet. Unrounded: a fraction of a px left over from `clearOf`'s own rounding is exactly the kind
 * of sliver this is for.
 */
function residualAt(target: Rect, size: Size, floats: readonly Rect[], from: { dx: number; dy: number }, margin: number): { dx: number; dy: number } {
  const sheet = { x: 0, y: 0, ...size };
  const grown = grownFloats(floats, margin);
  let dx = from.dx;
  let dy = from.dy;
  for (let pass = 0; pass < 4; pass++) {
    const current = shiftRect(target, dx, dy);
    const blockers = blocking(current, grown);
    if (blockers.length === 0) break;
    const best = DIRECTIONS.map((dir) => {
      const need = pushNeeded(current, blockers, dir);
      const moved = pushed(current, dir, need);
      return { dir, need, ok: withinArea(moved, sheet) && blocking(moved, grown).length === 0 };
    })
      .filter((c) => c.ok)
      .sort((a, b) => a.need - b.need)[0];
    if (!best) break;
    const moved = pushed(current, best.dir, best.need);
    dx += moved.x - current.x;
    dy += moved.y - current.y;
  }
  return { dx, dy };
}

/**
 * Runs `residualAt` at `CLEAR_MARGIN`'s breathing room, then, only if the card still truly overlaps a float
 * (not just sits within another float's margin), retries at zero margin and keeps whichever leaves less real
 * overlap. A card near three floats can have every direction blocked at `CLEAR_MARGIN` because clearing one
 * float's real rect would land inside a second float's *margin* alone (never its real rect): 2.4.11 asks that
 * a focused card isn't covered, not that it keeps the margin's gap, so a fix that exists only once the margin
 * gives way still counts and is worth taking over one that leaves the card genuinely covered.
 */
function clearResidual(target: Rect, size: Size, floats: readonly Rect[], from: { dx: number; dy: number }): { dx: number; dy: number } {
  const withMargin = residualAt(target, size, floats, from, CLEAR_MARGIN);
  const marginOverlap = overlapPx(shiftRect(target, withMargin.dx, withMargin.dy), floats);
  if (marginOverlap === 0) return withMargin;
  const noMargin = residualAt(target, size, floats, from, 0);
  const noMarginOverlap = overlapPx(shiftRect(target, noMargin.dx, noMargin.dy), floats);
  return noMarginOverlap < marginOverlap ? noMargin : withMargin;
}

/** Pans so a rect on screen (relative to the sheet) lies inside it and clear of every floating element. */
function clearOnScreen(target: Rect, options: MoveOptions): boolean {
  const viewport = sheetViewport();
  const size = sheetSize();
  const sheet = mounted()?.element() ?? null;
  const floats = sheet ? floatingRects(sheet) : [];
  const first = clearOf(target, { x: 0, y: 0, ...size }, floats, CLEAR_MARGIN);
  const { dx, dy } = clearResidual(target, size, floats, first);
  if (dx === 0 && dy === 0) return false;
  moveViewport({ x: viewport.x + dx, y: viewport.y + dy, zoom: viewport.zoom }, options);
  return true;
}

/**
 * Pans so `facet`'s card lies inside the sheet and clear of every floating element (spec L771, 2.4.11), using
 * its token-computed size (spec L824). True when the view moved.
 */
export function ensureVisible(facet: string, options: MoveOptions = {}): boolean {
  const rect = cardRect(doc.get().layout, sizes(), facet);
  if (!rect) return false;
  return clearOnScreen(toScreen(rect, sheetViewport()), options);
}

/**
 * After a placement, pans only if the new card would be off-screen (spec L426): when any part of it lies outside
 * the sheet, the view pans it in and clear of the floating UI (`ensureVisible`); a card that shows whole stays
 * put, even beside the tool strip. With no sheet mounted there's no screen for it to be off, so nothing moves.
 * True when the view moved.
 */
export function panToPlaced(facet: string): boolean {
  if (!mounted()) return false;
  const rect = cardRect(doc.get().layout, sizes(), facet);
  if (!rect) return false;
  const size = sheetSize();
  if (withinArea(toScreen(rect, sheetViewport()), { x: 0, y: 0, ...size })) return false;
  return ensureVisible(facet);
}

/**
 * Pans so an element inside a card (a pin row with keyboard focus) is clear of the floating UI, without
 * jumping back to the top of a card taller than the sheet. True when the view moved.
 */
export function ensureElementVisible(element: Element, options: MoveOptions = {}): boolean {
  const sheet = mounted()?.element();
  if (!sheet) return false;
  const box = sheet.getBoundingClientRect();
  const r = element.getBoundingClientRect();
  return clearOnScreen({ x: r.left - box.left, y: r.top - box.top, width: r.width, height: r.height }, options);
}
