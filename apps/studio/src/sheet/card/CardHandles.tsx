import type { Hex4, LayoutMetrics } from "@lattice-studio/core";
import { Handle, Position } from "@xyflow/react";
import { memo, useMemo } from "react";
import styles from "./FacetCard.module.css";
import { dependencyHandleId, pinHandleId } from "./node";

export type CardHandlesProps = {
  /** The drawn rows' selectors, top to bottom. Pass a stable array: the handles re-render when it changes. */
  rows: readonly Hex4[];
  side: "left" | "right";
  compact: boolean;
  metrics: LayoutMetrics;
};

const BOTH = ["source", "target"] as const;
const SIDES = ["left", "right"] as const;

/**
 * Where edges attach, at the same token geometry C9's `routeTraces` uses (never measured): a pin handle per
 * drawn row on the pin side, at the row's middle (compact: the tick strip's middle), and a dependency handle
 * at the header's middle on each side. Invisible and never connectable; the pin node is drawn by the row.
 * They sit outside the card's `content-visibility` subtree, so an off-screen card still has handle bounds.
 */
export const CardHandles = memo(function CardHandles({ rows, side, compact, metrics }: CardHandlesProps) {
  const pinPosition = side === "right" ? Position.Right : Position.Left;
  const headerStyle = useMemo(() => ({ top: metrics.headerHeight / 2 }), [metrics]);
  const rowStyles = useMemo(
    () =>
      rows.map((_, index) => ({
        // pinsPad is one grid step (C9 `layout/rows.ts`).
        top: compact
          ? metrics.headerHeight + metrics.rowHeight / 2
          : metrics.headerHeight + metrics.grid + index * metrics.rowHeight + metrics.rowHeight / 2,
      })),
    [rows, compact, metrics],
  );
  return (
    <>
      {SIDES.flatMap((at) =>
        BOTH.map((type) => (
          <Handle
            key={`${at}-${type}`}
            id={dependencyHandleId(at)}
            type={type}
            position={at === "right" ? Position.Right : Position.Left}
            isConnectable={false}
            className={styles.handle}
            style={headerStyle}
          />
        )),
      )}
      {rows.flatMap((selector, index) =>
        BOTH.map((type) => (
          <Handle
            key={`${selector}-${type}`}
            id={pinHandleId(selector)}
            type={type}
            position={pinPosition}
            isConnectable={false}
            className={styles.handle}
            style={rowStyles[index]}
          />
        )),
      )}
    </>
  );
});
