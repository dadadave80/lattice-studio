import { lazy, Suspense, useEffect, useRef } from "react";
import { announce, KEY_CONTEXT_ATTRIBUTE, log, registerDropTarget } from "@/contracts";
import { StartBlock } from "@/sheet/chrome/StartBlock";
import { SHEET_LOADING } from "./copy";
import { loadSheetParts } from "./parts";
import styles from "./Sheet.module.css";

/**
 * The first paint is the static shell (spec L818), so the canvas (React Flow and d3, the facet card, the
 * sheet's layers, Back to content, the grid and React Flow's `base.css`) is its own chunk, requested as soon as
 * the app renders, together with the parts other modules register for it (`parts.ts`). The commands, the view
 * API (`sheet-view.ts`) and the stored viewport are in the entry, so nothing that runs before then is lost: a
 * zoom or Locate moves the stored viewport and the canvas opens there.
 */
const SheetCanvas = lazy(() =>
  Promise.all([loadSheetParts(), import("./SheetCanvas")]).then(([, m]) => ({ default: m.SheetCanvas })),
);

const KEY_CONTEXT = { [KEY_CONTEXT_ATTRIBUTE]: "sheet" };

/**
 * The sheet while its canvas loads: the region's ground and, on an empty sheet, the Start block, which is the
 * empty sheet's largest paint (spec L815) and works before the canvas does; the canvas's own Start block layer
 * takes over when it mounts. A catalog row dropped here places nothing, so the drop says why (Q28) rather than
 * vanishing.
 */
function SheetLoading() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    return registerDropTarget({
      element,
      drop: () => {
        log({ tag: "Note", text: SHEET_LOADING });
        announce(SHEET_LOADING);
      },
    });
  }, []);
  return (
    <div ref={ref} className={styles.sheet} data-sheet-loading="" {...KEY_CONTEXT}>
      <StartBlock />
    </div>
  );
}

/** The sheet (WP-S4b): see `SheetCanvas.tsx`. */
export function Sheet() {
  return (
    <Suspense fallback={<SheetLoading />}>
      <SheetCanvas />
    </Suspense>
  );
}
