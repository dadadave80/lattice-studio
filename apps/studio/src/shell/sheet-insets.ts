/**
 * The sheet's insets in px, for code that can't read `--sheet-inset-start` and `--sheet-inset-end` from CSS: the
 * core cell (whether it fits beside the title block) and Fit (the room it frames cards into).
 */
import { session, useSession } from "@/contracts";
import { currentTier, useLayoutTier } from "./layout-tier";
import { sheetInsets, type SheetInsets } from "./panes";

/** The insets now, for non-render code. */
export function currentSheetInsets(): SheetInsets {
  return sheetInsets(session.get().panes, currentTier());
}

/** The insets, re-rendering when a drawer opens, closes or resizes, or the tier changes. */
export function useSheetInsets(): SheetInsets {
  const tier = useLayoutTier();
  const start = useSession((s) => sheetInsets(s.panes, tier).start);
  const end = useSession((s) => sheetInsets(s.panes, tier).end);
  return { start, end };
}
