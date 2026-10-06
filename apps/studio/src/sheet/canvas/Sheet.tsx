import { lazy, Suspense } from "react";
import { loadSheetParts } from "./parts";

/**
 * The first paint is the static shell (spec L818), so the canvas (React Flow and d3, the facet card, the
 * sheet's layers, Back to content, the grid and React Flow's `base.css`) is its own chunk, requested as soon as
 * the app renders, together with the parts other modules register for it (`parts.ts`). Until it lands the sheet
 * region shows its ground. The commands, the view API (`sheet-view.ts`) and the stored viewport are in the entry,
 * so nothing that runs before then is lost: a zoom or Locate moves the stored viewport and the canvas opens there.
 */
const SheetCanvas = lazy(() =>
  Promise.all([loadSheetParts(), import("./SheetCanvas")]).then(([, m]) => ({ default: m.SheetCanvas })),
);

/** The sheet (WP-S4b): see `SheetCanvas.tsx`. */
export function Sheet() {
  return (
    <Suspense fallback={null}>
      <SheetCanvas />
    </Suspense>
  );
}
