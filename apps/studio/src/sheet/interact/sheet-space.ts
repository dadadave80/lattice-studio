/**
 * Screen and sheet coordinates for the interactions, from the view S4b keeps (`sheetViewport()`), and card
 * sizes from the tokens (spec L824). Works on the mounted sheet: the element is React Flow's root.
 */
import type { Point, Sizes } from "@lattice-studio/core";
import { doc, getAnalysis, getCatalog, layoutMetrics } from "@/contracts";
import { cardSizes } from "@/sheet/canvas/geometry";
import { sheetSize, sheetViewport } from "@/sheet/canvas/sheet-view";
import { snapPoint } from "./geometry";

/** React Flow's root element, the box the viewport is relative to. */
export function flowRoot(from?: EventTarget | null): HTMLElement | null {
  if (from instanceof Element) {
    const own = from.closest<HTMLElement>(".react-flow");
    if (own) return own;
  }
  return document.querySelector<HTMLElement>('[data-region="sheet"] .react-flow') ?? document.querySelector<HTMLElement>(".react-flow");
}

/** A client point relative to the sheet's top-left corner, in screen px. */
export function toLocal(client: Point, root: HTMLElement | null): Point {
  const box = root?.getBoundingClientRect();
  return { x: client.x - (box?.left ?? 0), y: client.y - (box?.top ?? 0) };
}

/** A client point on the sheet, in sheet units. */
export function toSheet(client: Point, root: HTMLElement | null): Point {
  const local = toLocal(client, root);
  const v = sheetViewport();
  return { x: (local.x - v.x) / v.zoom, y: (local.y - v.y) / v.zoom };
}

/** The middle of the visible sheet, in sheet units, snapped. */
export function viewCenter(): Point {
  const v = sheetViewport();
  const size = sheetSize();
  return snapPoint({ x: (size.width / 2 - v.x) / v.zoom, y: (size.height / 2 - v.y) / v.zoom }, layoutMetrics.snap);
}

/** Every placed card's size as the sheet draws it at full size. */
export function currentSizes(): Sizes {
  return cardSizes(doc.get().layout, getCatalog(), getAnalysis());
}

/** A pointer or mouse event's client point; a touch event's first touch. */
export function clientPoint(event: MouseEvent | TouchEvent | PointerEvent): Point | null {
  if ("touches" in event) {
    const touch = event.touches[0] ?? event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }
  return { x: event.clientX, y: event.clientY };
}
