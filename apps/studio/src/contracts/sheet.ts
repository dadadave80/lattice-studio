/**
 * The sheet's mounting seam. S4b owns `<ReactFlow>`; the modules built beside it plug in here, so none of
 * them edits S4b's files and S4b never imports theirs:
 *
 * - **Layers** (S4c notes and leaders, S4d's tool strip, zoom readout and title block in `Panel`s, S4e's
 *   marquee and Move to… ghost): components S4b renders as children of `<ReactFlow>`, in `order`, so they
 *   can use React Flow's hooks. `order` is DOM order and so Tab order (spec L752: tool strip, notes, title
 *   block): 1 Start block, 2 tool strip and zoom readout, 10 notes, 20 interaction overlays, 28 init-order
 *   chip and legend, 30 title block, 32 core cell (its traces draw in their own SVG at z 3). `ViewportPortal` content lands before every `Panel` in the DOM whatever
 *   its order, so the notes are a plain layer that follows the viewport, not a portal.
 * - **Node and edge types** (S4a's facet card, S4c's traces and ties): registered at module evaluation;
 *   S4b reads `sheetNodeTypes()` and `sheetEdgeTypes()` once, at its own module scope, after `discover`
 *   has run, so the objects never change identity (spec L825).
 * - **Interactions** (S4e): one hook returning React Flow props (pointer handlers, selection, drag), merged
 *   under the props S4b sets itself.
 */
import type { EdgeTypes, NodeTypes, ReactFlowProps } from "@xyflow/react";
import type { ComponentType } from "react";

export type SheetLayer = {
  /** Unique: "notes", "tool-strip", "title-block", "marquee". */
  id: string;
  order: number;
  Component: ComponentType;
};

const layers = new Map<string, SheetLayer>();
const nodeTypes: NodeTypes = {};
const edgeTypes: EdgeTypes = {};

/** Adds a layer inside `<ReactFlow>`. Throws on a duplicate id. Returns a disposer. */
export function registerSheetLayer(layer: SheetLayer): () => void {
  if (layers.has(layer.id)) throw new Error(`Sheet layer ${layer.id} is already registered.`);
  layers.set(layer.id, layer);
  return () => {
    if (layers.get(layer.id) === layer) layers.delete(layer.id);
  };
}

/** The layers, in order. */
export function sheetLayers(): SheetLayer[] {
  return [...layers.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Registers a React Flow node type ("facet"). Throws on a duplicate. */
export function registerNodeType(type: string, component: NodeTypes[string]): void {
  if (nodeTypes[type]) throw new Error(`Node type ${type} is already registered.`);
  nodeTypes[type] = component;
}

/** Registers a React Flow edge type ("dependency", "tie"). Throws on a duplicate. */
export function registerEdgeType(type: string, component: EdgeTypes[string]): void {
  if (edgeTypes[type]) throw new Error(`Edge type ${type} is already registered.`);
  edgeTypes[type] = component;
}

/** The registered node types: one object for the app's lifetime. */
export function sheetNodeTypes(): NodeTypes {
  return nodeTypes;
}

/** The registered edge types: one object for the app's lifetime. */
export function sheetEdgeTypes(): EdgeTypes {
  return edgeTypes;
}

/** Props S4e's interactions add to `<ReactFlow>`. */
export type SheetInteractionProps = Partial<ReactFlowProps>;

let useInteractions: () => SheetInteractionProps = () => ({});

/** S4e provides its interactions hook at module evaluation. Returns a disposer. */
export function provideSheetInteractions(hook: () => SheetInteractionProps): () => void {
  const previous = useInteractions;
  useInteractions = hook;
  return () => {
    if (useInteractions === hook) useInteractions = previous;
  };
}

/** S4b calls this in its sheet component and spreads the result onto `<ReactFlow>`. A hook. */
export function useSheetInteractions(): SheetInteractionProps {
  return useInteractions();
}
