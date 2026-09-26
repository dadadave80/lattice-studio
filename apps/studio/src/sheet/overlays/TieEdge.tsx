import type { EdgeProps } from "@xyflow/react";
import { memo } from "react";
import { pathOf, type SheetEdge } from "./edge-data";
import styles from "./Edges.module.css";

/**
 * A collision tie (IR L107): 2 px accent between two contenders' pins for one contested selector, dashed in
 * forced colors. Not focusable: the note and the card's description say it in words (spec L746).
 */
export const TieEdge = memo(function TieEdge({ id, data }: EdgeProps<SheetEdge>) {
  if (!data) return null;
  return <path className={styles.tie} d={pathOf(data.points)} data-edge={id} data-selector={data.selector} />;
});
