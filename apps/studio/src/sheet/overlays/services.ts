/**
 * S4c's registrations (contracts `sheet.ts`, `dialogs.ts`; found by `discover.ts`): the dependency trace and
 * collision tie edge types, the layer that sets the edges and draws the notes, and Choose per selector. React
 * Flow needs the edge types at module scope, so they're registered here as thin wrappers; what they draw, the
 * layer and the dialog load as their own chunk (spec L822). No edge exists before the layer sets them, so the
 * edges' code is always there by the time one draws.
 *
 * The notes layer's order is 10, as `sheet.ts` suggests: after S4d's tool strip and before its title block,
 * so Tab goes card grid, tool strip, notes, title block (spec L744).
 */
import type { EdgeProps } from "@xyflow/react";
import { createElement, lazy, Suspense } from "react";
import { registerDialog, registerEdgeType, registerSheetLayer, type DialogComponentProps } from "@/contracts";
import type { SheetEdge } from "./edge-data";
import { TIE_EDGE_TYPE, TRACE_EDGE_TYPE } from "./edge-types";

const LazyOverlayLayer = lazy(() => import("./OverlayLayer").then((m) => ({ default: m.OverlayLayer })));
const LazyTraceEdge = lazy(() => import("./TraceEdge").then((m) => ({ default: m.TraceEdge })));
const LazyTieEdge = lazy(() => import("./TieEdge").then((m) => ({ default: m.TieEdge })));
const LazyChoosePerSelector = lazy(() =>
  import("./ChoosePerSelectorDialog").then((m) => ({ default: m.ChoosePerSelectorDialog })),
);

function NotesLayer() {
  return createElement(Suspense, { fallback: null }, createElement(LazyOverlayLayer));
}

function TraceEdgeType(props: EdgeProps<SheetEdge>) {
  return createElement(Suspense, { fallback: null }, createElement(LazyTraceEdge, props));
}

function TieEdgeType(props: EdgeProps<SheetEdge>) {
  return createElement(Suspense, { fallback: null }, createElement(LazyTieEdge, props));
}

function ChoosePerSelector(props: DialogComponentProps<"choose-per-selector">) {
  return createElement(Suspense, { fallback: null }, createElement(LazyChoosePerSelector, props));
}

registerEdgeType(TRACE_EDGE_TYPE, TraceEdgeType);
registerEdgeType(TIE_EDGE_TYPE, TieEdgeType);
registerSheetLayer({ id: "notes", order: 10, Component: NotesLayer });
registerDialog("choose-per-selector", ChoosePerSelector);
