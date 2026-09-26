import { lazy, Suspense } from "react";

/** The layer's parts load with their own chunk, after the canvas, so none of them weighs on the first paint. */
const SheetOverlays = lazy(() => import("./SheetOverlays").then((m) => ({ default: m.SheetOverlays })));

/**
 * S4e's layer inside `<ReactFlow>` (contracts `sheet.ts`, order 20): the marquee, Move to…'s ghost and
 * crosshair, the catalog drop ghost with its "x · y", and the context menus. Its own Suspense boundary keeps the
 * canvas showing while the chunk loads.
 */
export function InteractionsLayer() {
  return (
    <Suspense fallback={null}>
      <SheetOverlays />
    </Suspense>
  );
}
