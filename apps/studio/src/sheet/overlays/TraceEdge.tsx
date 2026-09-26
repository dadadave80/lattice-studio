import { EdgeLabelRenderer, useStore, type EdgeProps } from "@xyflow/react";
import { memo, useState } from "react";
import { layoutMetrics, useSession } from "@/contracts";
import { pathOf, type SheetEdge } from "./edge-data";
import { useCardFocused } from "./focused-card";
import styles from "./Edges.module.css";

/**
 * A dependency trace (IR L106): 1.5 px ink, 2 px accent when either end is selected. Its reason ("needs
 * ERC4626") sits at the midpoint from 75% zoom, and below that while the trace is hovered or either end is
 * selected or has keyboard focus. Not focusable: the card's description says it in words (spec L746).
 */
export const TraceEdge = memo(function TraceEdge({ id, source, target, data }: EdgeProps<SheetEdge>) {
  const live = useSession((s) => s.selection.includes(source) || s.selection.includes(target));
  const zoomedIn = useStore((s) => s.transform[2] >= layoutMetrics.traceLabelZoom);
  const focused = useCardFocused(source, target);
  const [hover, setHover] = useState(false);
  if (!data) return null;
  const d = pathOf(data.points);
  const showLabel = data.label !== undefined && (zoomedIn || hover || live || focused);
  return (
    <>
      <g
        className={styles.trace}
        data-edge={id}
        data-live={live ? "" : undefined}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
      >
        <path className={styles.hit} d={d} />
        <path className={styles.line} d={d} />
      </g>
      {showLabel ? (
        <EdgeLabelRenderer>
          <div
            className={styles.label}
            data-trace-label={id}
            data-live={live ? "" : undefined}
            style={{ transform: `translate(-50%, -50%) translate(${data.mid.x}px, ${data.mid.y}px)` }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});
