/**
 * S4c's registrations (contracts `sheet.ts`, `dialogs.ts`; found by `discover.ts`): the dependency trace and
 * collision tie edge types, the layer that sets the edges and draws the notes, and Choose per selector. The
 * layer and the dialog are their own chunks (spec L822); the edge types are the two small components React
 * Flow needs at module scope.
 *
 * The notes layer's order is 10, as `sheet.ts` suggests: after S4d's tool strip and before its title block,
 * so Tab goes card grid, tool strip, notes, title block (spec L744).
 */
import { createElement, lazy, Suspense } from "react";
import { registerDialog, registerEdgeType, registerSheetLayer, type DialogComponentProps } from "@/contracts";
import { TIE_EDGE_TYPE, TRACE_EDGE_TYPE } from "./edge-data";
import { TieEdge } from "./TieEdge";
import { TraceEdge } from "./TraceEdge";

const LazyOverlayLayer = lazy(() => import("./OverlayLayer").then((m) => ({ default: m.OverlayLayer })));
const LazyChoosePerSelector = lazy(() =>
  import("./ChoosePerSelectorDialog").then((m) => ({ default: m.ChoosePerSelectorDialog })),
);

function NotesLayer() {
  return createElement(Suspense, { fallback: null }, createElement(LazyOverlayLayer));
}

function ChoosePerSelector(props: DialogComponentProps<"choose-per-selector">) {
  return createElement(Suspense, { fallback: null }, createElement(LazyChoosePerSelector, props));
}

registerEdgeType(TRACE_EDGE_TYPE, TraceEdge);
registerEdgeType(TIE_EDGE_TYPE, TieEdge);
registerSheetLayer({ id: "notes", order: 10, Component: NotesLayer });
registerDialog("choose-per-selector", ChoosePerSelector);
