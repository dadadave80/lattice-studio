import { lazy, Suspense } from "react";

/**
 * The first paint is the static shell (spec L818), so the canvas (the sheet's React Flow component, its
 * layers, Back to content, the grid and React Flow's `base.css`) is its own chunk, requested as soon as the app
 * renders. Until it lands the sheet region shows its ground. The commands, the view API (`sheet-view.ts`) and
 * the stored viewport are in the entry, so nothing that runs before then is lost: a zoom or Locate moves the
 * stored viewport and the canvas opens there.
 */
const SheetCanvas = lazy(() => import("./SheetCanvas").then((m) => ({ default: m.SheetCanvas })));

/** The sheet (WP-S4b): see `SheetCanvas.tsx`. */
export function Sheet() {
  return (
    <Suspense fallback={null}>
      <SheetCanvas />
    </Suspense>
  );
}
