import { Background, BackgroundVariant, useStore } from "@xyflow/react";
import { layoutMetrics } from "@/contracts";
import { cx } from "@/ui";
import styles from "./Sheet.module.css";
import { gridGap } from "./viewport-math";

/**
 * The 8 px dot grid (spec L357), drawn by React Flow so it pans and zooms with the cards. Zoomed out, the
 * pitch doubles so the dots stay apart. Its color is `--lx-dot`, transparent in forced colors, where the grid
 * is hidden altogether.
 */
export function SheetGrid() {
  const gap = useStore((s) => gridGap(s.transform[2], layoutMetrics.grid));
  return (
    <Background
      id="sheet-grid"
      className={cx(styles.grid)}
      variant={BackgroundVariant.Dots}
      gap={gap}
      size={1.5}
      color="var(--lx-dot)"
    />
  );
}
