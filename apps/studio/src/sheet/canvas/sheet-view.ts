/**
 * The sheet's view, for commands and the modules built beside the canvas (S4c, S4d, S4e). The viewport
 * belongs to the project (spec L402, PA L14): it lives in the session per project id and is saved through
 * `saveViewport`, and the mounted sheet follows it. Every function here works with or without a mounted
 * sheet: without one, it moves the stored viewport, and the sheet opens there.
 *
 * - `ensureVisible(facet)`: pans a card clear of everything floating over the sheet (2.4.11, spec L771). The
 *   sheet calls it itself when a card takes keyboard focus; S4e calls it before focusing a card it moves to.
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
import { cardRect, cardSizes, cardsBounds } from "./geometry";
import {
  centerOn, clampZoom, clearOf, FIT_MAX_ZOOM, fitRect, intersects, LOCATE_ZOOM, MAX_ZOOM, toScreen, zoomAt,
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

/** Frames `names` (every card when omitted), up to 100% for Fit and 200% for a selection. Null when none is placed. */
export function fitCards(names?: readonly string[]): Viewport | null {
  const layout = doc.get().layout;
  const bounds = cardsBounds(layout, sizes(), names);
  if (!bounds) return null;
  return moveViewport(fitRect(bounds, sheetSize(), { maxZoom: names ? MAX_ZOOM : FIT_MAX_ZOOM }));
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

/** Pans so a rect on screen (relative to the sheet) lies inside it and clear of every floating element. */
function clearOnScreen(target: Rect, options: MoveOptions): boolean {
  const viewport = sheetViewport();
  const size = sheetSize();
  const sheet = mounted()?.element() ?? null;
  const floats = sheet ? floatingRects(sheet) : [];
  const { dx, dy } = clearOf(target, { x: 0, y: 0, ...size }, floats, CLEAR_MARGIN);
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
