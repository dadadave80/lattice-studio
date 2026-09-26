/**
 * Dragging cards (Flow 8, IR L43): React Flow notices the drag (4 px threshold, `nodrag` rows) and reports the
 * pointer; the offset is ours. The whole selection moves together, the grabbed card snapped to 8 px and the
 * others keeping their places relative to it; the document changes live inside `doc.begin`, so the drag is one
 * undo step. Near the sheet's edge the view scrolls, faster the deeper the pointer is in a 48 px zone, and the
 * cards keep up with it. On release a card that landed on another one slides to the nearest free slot.
 */
import type { Layout, Point } from "@lattice-studio/core";
import { announce, doc, layoutMetrics, session } from "@/contracts";
import { panSheet, sheetSize, storeSheetViewport } from "@/sheet/canvas/sheet-view";
import { edgeScroll, settledOffset, snapPoint } from "./geometry";
import { moveLabel, movedWords, placeFrom } from "./moves";
import { currentSizes, toLocal, toSheet } from "./sheet-space";

type Drag = {
  names: string[];
  /** The layout when the drag began. */
  base: Layout;
  /** The grabbed card's position when the drag began. */
  anchor: Point;
  /** The pointer on the sheet when the drag began. */
  start: Point;
  root: HTMLElement | null;
  client: Point;
  offset: Point;
  frame: number;
  scrolled: boolean;
};

let drag: Drag | null = null;

/** Whether a card drag is in progress. */
export function dragging(): boolean {
  return drag !== null;
}

function offsetNow(d: Drag): Point {
  const pointer = toSheet(d.client, d.root);
  const at = snapPoint({ x: d.anchor.x + pointer.x - d.start.x, y: d.anchor.y + pointer.y - d.start.y }, layoutMetrics.snap);
  return { x: at.x - d.anchor.x, y: at.y - d.anchor.y };
}

function follow(d: Drag): void {
  const next = offsetNow(d);
  if (next.x === d.offset.x && next.y === d.offset.y) return;
  d.offset = next;
  doc.update(placeFrom(d.base, d.names, next));
}

function tick(): void {
  const d = drag;
  if (!d) return;
  const v = edgeScroll(toLocal(d.client, d.root), sheetSize());
  if (v.x !== 0 || v.y !== 0) {
    panSheet(v.x, v.y, { store: false });
    d.scrolled = true;
    follow(d);
  }
  d.frame = requestAnimationFrame(tick);
}

/**
 * Starts moving `names` (the selection, with the grabbed card `grabbed` among them): the card was pressed at
 * `pressed` and the pointer is at `client` now (past the threshold). Refused, and nothing moves, while the
 * session is read-only (the store logs why).
 */
export function beginDrag(names: readonly string[], grabbed: string, pressed: Point, client: Point, root: HTMLElement | null): void {
  endDrag(null);
  const base = doc.get().layout;
  const entry = base[grabbed];
  const moving = names.filter((name) => base[name]);
  if (!entry || moving.length === 0) return;
  doc.begin(moveLabel(moving));
  // Read-only: the store refused and logged its reason; nothing follows the pointer.
  if (session.get().readOnly !== null) return;
  drag = {
    names: moving,
    base,
    anchor: { x: entry.x, y: entry.y },
    start: toSheet(pressed, root),
    root,
    client,
    offset: { x: 0, y: 0 },
    frame: requestAnimationFrame(tick),
    scrolled: false,
  };
  window.addEventListener("blur", interrupted);
  document.addEventListener("visibilitychange", hidden);
  follow(drag);
}

/** The window lost focus mid-drag (another app, a dialog): the drag ends where the cards are. */
function interrupted(): void {
  endDrag(null);
}

function hidden(): void {
  if (document.visibilityState === "hidden") endDrag(null);
}

/** The pointer moved. */
export function moveDrag(client: Point): void {
  if (!drag) return;
  drag.client = client;
  follow(drag);
}

/**
 * The pointer let go (at `client`, when known): settle the cards, commit one undo step and say where they went.
 * `null` ends a drag that was interrupted (the window lost focus or was hidden, the sheet went away), keeping
 * where the cards are: its frame loop stops and its undo step closes.
 */
export function endDrag(client: Point | null): void {
  const d = drag;
  if (!d) return;
  drag = null;
  cancelAnimationFrame(d.frame);
  window.removeEventListener("blur", interrupted);
  document.removeEventListener("visibilitychange", hidden);
  if (client) {
    d.client = client;
    follow(d);
  }
  const settled = settledOffset(d.base, currentSizes(), d.names, d.offset, layoutMetrics);
  if (settled.x !== d.offset.x || settled.y !== d.offset.y) doc.update(placeFrom(d.base, d.names, settled));
  const moved = settled.x !== 0 || settled.y !== 0;
  doc.commit();
  if (d.scrolled) storeSheetViewport();
  if (moved) announce(movedWords(d.names, doc.get().layout));
}
