/**
 * What S4e adds to `<ReactFlow>` (contracts `sheet.ts`): React Flow's own selecting off, a 4 px drag threshold, no
 * auto-pan of its own (the runtime scrolls in a 48 px edge zone), and handlers that pass every pointer and key
 * event to the interactions runtime (`handlers.ts`, loaded with the layer: see `runtime.ts`).
 *
 * One object for the app's lifetime, and no hooks: a test may swap the interactions between renders. Read-only
 * needs no prop of its own: a drag's `doc.begin` is refused (and says why), and the cards follow the document,
 * which doesn't change. While Move to… places the selection, its layer takes the presses, so nothing drags.
 */
import { layoutSizes } from "@lattice-studio/tokens";
import type { MouseEvent, TouchEvent } from "react";
import type { SheetInteractionProps } from "@/contracts";
import type { Handlers } from "./handlers";
import { notePress } from "./press";
import { loadRuntime, loadedRuntime, withRuntime } from "./runtime";

/** Shift, ⌘ or Ctrl held: a click adds or removes a card (IR L42), and React Flow keeps the rest selected. */
const MULTI_KEYS = ["Shift", "Meta", "Control"];

/** A handler that runs in the runtime: at once when it's here, else as soon as it loads, in order. */
function via<K extends keyof Handlers>(name: K): Handlers[K] {
  const call = (...args: unknown[]) => {
    void withRuntime((r) => (r.handlers[name] as (...a: unknown[]) => void)(...args));
  };
  return call as Handlers[K];
}

/** A handler that has to decide now (whether to take the key): nothing to do until the runtime is here. */
function now<K extends keyof Handlers>(name: K): Handlers[K] {
  const call = (...args: unknown[]) => {
    const r = loadedRuntime();
    if (r) (r.handlers[name] as (...a: unknown[]) => void)(...args);
  };
  return call as Handlers[K];
}

const onNodeContextMenu: Handlers["onNodeContextMenu"] = (event, node) => {
  // The browser's own menu never shows over a card, even before the runtime is here.
  event.preventDefault();
  void withRuntime((r) => r.handlers.onNodeContextMenu(event, node));
};

/**
 * A press on a card: noted here, in the first load, so the drag that may follow anchors where the card was
 * grabbed even before the runtime has loaded; and the runtime asked for if it isn't here yet.
 */
function onPress(event: MouseEvent<HTMLDivElement> | TouchEvent<HTMLDivElement>): void {
  const card = event.target instanceof Element ? event.target.closest<HTMLElement>(".react-flow__node[data-id]") : null;
  const facet = card?.dataset.id;
  const point = "touches" in event ? event.touches[0] : event;
  notePress(facet !== undefined && point ? { facet, client: { x: point.clientX, y: point.clientY } } : null);
  if (!loadedRuntime()) void loadRuntime();
}

const PROPS: SheetInteractionProps = {
  elementsSelectable: false,
  selectNodesOnDrag: false,
  selectionOnDrag: false,
  selectionKeyCode: null,
  multiSelectionKeyCode: MULTI_KEYS,
  nodeDragThreshold: layoutSizes.dragThreshold,
  nodeClickDistance: layoutSizes.dragThreshold,
  autoPanOnNodeDrag: false,
  autoPanOnSelection: false,
  onNodeClick: via("onNodeClick"),
  onNodeDoubleClick: via("onNodeDoubleClick"),
  onNodeDragStart: via("onNodeDragStart"),
  onNodeDrag: via("onNodeDrag"),
  onNodeDragStop: via("onNodeDragStop"),
  onNodeContextMenu,
  onPaneContextMenu: via("onPaneContextMenu"),
  onKeyDown: now("onKeyDown"),
  onFocus: via("onFocus"),
  onBlur: now("onBlur"),
  onMouseDownCapture: onPress,
  onTouchStartCapture: onPress,
};

/** S4e's props for `<ReactFlow>`, spread under S4b's own (contracts `sheet.ts`). */
export function useSheetInteractionProps(): SheetInteractionProps {
  return PROPS;
}
