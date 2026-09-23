/**
 * The pointer and key handlers S4e puts on `<ReactFlow>` (through `use-sheet-interactions.ts`): selecting,
 * dragging, the rows inside a card and the context menus. React Flow keeps doing what it does well (noticing a
 * drag past 4 px, `nodrag` rows, touch), while every decision is ours and every change goes to the session or the
 * document: React Flow's own selecting is off (`elementsSelectable`), the marquee is drawn by the interactions
 * layer, and positions come from the document, never from React Flow's position changes.
 *
 * Part of the interactions runtime, loaded with the layer (`runtime.ts`), not the first load.
 */
import type { Hex4 } from "@lattice-studio/core";
import type { Node, NodeMouseHandler, OnNodeDrag } from "@xyflow/react";
import type { FocusEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, TouchEvent } from "react";
import { commandRef, runCommand, session } from "@/contracts";
import { isContextMenuKey } from "@/ui/overlays/context-menu-key";
import { beginDrag, endDrag, moveDrag } from "./drag";
import { toggled } from "./geometry";
import { cardOf, leaveRows, moveBetweenRows } from "./focus";
import { openSheetMenu } from "./menu-state";
import { select } from "./selection";
import { clientPoint, flowRoot, toSheet } from "./sheet-space";

function adds(event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean {
  return event.shiftKey || event.metaKey || event.ctrlKey;
}

/** Hand tool or Space held: clicks and drags pan, and never select (IR L52). */
function panning(target: EventTarget | null): boolean {
  if (session.get().tool === "hand") return true;
  return target instanceof Element && target.closest("[data-panning]") !== null;
}

function focusAnchor(facet: string): void {
  const focus = session.get().focus;
  if (focus?.kind === "facet" && focus.facet === facet) return;
  session.set({ focus: { kind: "facet", facet } });
}

/** A click on a card selects it; Shift or ⌘/Ctrl adds or removes it (IR L42). */
const onNodeClick: NodeMouseHandler<Node> = (event, node) => {
  if (panning(event.target)) return;
  const selection = session.get().selection;
  select(adds(event) ? toggled(selection, node.id) : [node.id]);
  focusAnchor(node.id);
};

/** Double-click a card: open it in the inspector with its Selectors list focused (IR L45). */
const onNodeDoubleClick: NodeMouseHandler<Node> = (_event, node) => {
  void runCommand(commandRef("inspector.focusSelectors", { facet: node.id }), "button");
};

/** Where the last press on a card was, for the drag that may follow it. */
let press: { facet: string; client: { x: number; y: number } } | null = null;

function onPress(event: ReactMouseEvent<HTMLDivElement> | TouchEvent<HTMLDivElement>): void {
  const facet = cardOf(event.target instanceof Element ? event.target : null);
  const client = clientPoint(event.nativeEvent);
  press = facet !== null && client ? { facet, client } : null;
}

/**
 * A drag moves the selection. Grabbing a card that isn't selected selects it first (with Shift, ⌘ or Ctrl held,
 * adds it), so what moves is always what's selected.
 */
const onNodeDragStart: OnNodeDrag<Node> = (event, node) => {
  const selection = session.get().selection;
  const next = selection.includes(node.id) ? selection : adds(event) ? [...selection, node.id] : [node.id];
  select(next);
  // From where the card was grabbed, not where the pointer crossed the threshold, so it stays under the pointer.
  const client = clientPoint(event);
  const pressed = press?.facet === node.id ? press.client : client;
  press = null;
  if (client && pressed) beginDrag(next, node.id, pressed, client, flowRoot(event.target));
};

const onNodeDrag: OnNodeDrag<Node> = (event) => {
  const client = clientPoint(event);
  if (client) moveDrag(client);
};

const onNodeDragStop: OnNodeDrag<Node> = (event) => {
  endDrag(clientPoint(event));
};

function pinOf(target: EventTarget | null): { row: HTMLElement; selector: Hex4 } | null {
  if (!(target instanceof Element)) return null;
  const row = target.closest<HTMLElement>("[data-card-row][data-selector]");
  const selector = row?.dataset.selector;
  return row && selector ? { row, selector: selector as Hex4 } : null;
}

/** Right-click (or long press) on a card or a pin (IR L46, L195). A card that isn't selected is selected first. */
const onNodeContextMenu: NodeMouseHandler<Node> = (event, node) => {
  event.preventDefault();
  const selection = session.get().selection;
  if (!selection.includes(node.id)) select([node.id]);
  const pin = pinOf(event.target);
  const invoker = pin?.row ?? (event.currentTarget instanceof HTMLElement ? event.currentTarget : null);
  const client = { x: event.clientX, y: event.clientY };
  openSheetMenu(pin ? { kind: "pin", facet: node.id, selector: pin.selector } : { kind: "card", facet: node.id }, client, invoker);
};

/** Right-click, the menu key or a long press on empty sheet (S4b forwards them, IR L46, L196). */
function onPaneContextMenu(event: MouseEvent | ReactMouseEvent): void {
  event.preventDefault();
  const root = flowRoot(event.target);
  const client = { x: event.clientX, y: event.clientY };
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  openSheetMenu({ kind: "sheet", at: toSheet(client, root) }, client, active);
}

/** Below an element, for a context menu opened from the keyboard. */
function below(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.bottom };
}

/**
 * Keys React Flow's element sees first: Shift+F10 or the menu key on a card or a pin opens its menu below it,
 * and ↑ ↓ Home End move between a card's rows (IR L22). Handled keys are consumed, so S2's dispatcher on
 * `window` leaves them alone.
 */
function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (isContextMenuKey(event)) {
    const pin = pinOf(target);
    const facet = cardOf(target);
    if (facet === null) return;
    event.preventDefault();
    if (!session.get().selection.includes(facet)) select([facet]);
    const invoker = pin?.row ?? target;
    openSheetMenu(pin ? { kind: "pin", facet, selector: pin.selector } : { kind: "card", facet }, below(invoker), invoker);
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (target.matches("[data-card-row]") && moveBetweenRows(target, event.key)) event.preventDefault();
}

/** Keeps the session's focus anchor on the card that has focus (the grid's Tab stop follows it, spec L744). */
function onFocus(event: FocusEvent<HTMLDivElement>): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const facet = cardOf(target);
  if (facet === null) return;
  if (target.matches(".react-flow__node")) focusAnchor(facet);
}

/** Focus leaving a card's rows (Tab, a click elsewhere) ends the rows mode. */
function onBlur(event: FocusEvent<HTMLDivElement>): void {
  const rows = session.get().modes.rows;
  if (rows === null) return;
  const next = event.relatedTarget;
  if (next instanceof Element && next.matches("[data-card-row]") && cardOf(next) === rows) return;
  leaveRows(false);
}

/** Every handler, for the entry's props to call once the runtime has loaded. */
export const handlers = {
  onNodeClick, onNodeDoubleClick, onNodeDragStart, onNodeDrag, onNodeDragStop, onNodeContextMenu, onPaneContextMenu,
  onKeyDown, onFocus, onBlur, onPress,
};

export type Handlers = typeof handlers;
