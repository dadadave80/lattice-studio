import { lazy, Suspense } from "react";
import { useSheetDropTarget } from "./drop-target";

/** The layer's parts load with their own chunk, after the canvas, so none of them weighs on the first paint. */
const SheetOverlays = lazy(() => import("./SheetOverlays").then((m) => ({ default: m.SheetOverlays })));

/**
 * S4e's layer inside `<ReactFlow>` (contracts `sheet.ts`, order 20): the marquee, Move to…'s ghost and
 * crosshair, the catalog drop ghost with its "x · y", and the context menus. Its own Suspense boundary keeps the
 * canvas showing while the chunk loads. The catalog drop target is registered here, in the shell, so a row dropped
 * after the canvas has mounted but before this chunk has loaded is still placed (`drop-target.ts`). A drop before
 * the canvas chunk itself mounts still has no target and places nothing: an open product call (Q28).
 */
export function InteractionsLayer() {
  useSheetDropTarget();
  return (
    <Suspense fallback={null}>
      <SheetOverlays />
    </Suspense>
  );
}
