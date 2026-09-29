import type { Size } from "@lattice-studio/core";
import { cardSize, contestedSelectors, isNotImplemented } from "@lattice-studio/core";
import { ViewportPortal } from "@xyflow/react";
import { useMemo } from "react";
import { getAnalysis, getCatalog, layoutMetrics } from "@/contracts";
import { useDropPreview } from "./drop-target";
import styles from "./interact.module.css";

/** The card a catalog row would become, at full size: its header, rows and footer (C9's `cardSize`). */
function ghostSize(facet: string): Size {
  const fallback = { width: layoutMetrics.cardWidth, height: layoutMetrics.headerHeight + layoutMetrics.footerHeight };
  const entry = getCatalog()?.facets.find((f) => f.name === facet);
  if (!entry) return fallback;
  try {
    const size = cardSize(entry, {
      metrics: layoutMetrics, expanded: false, pins: "right", compact: false, contested: contestedSelectors(getAnalysis(), facet),
    });
    return { width: size.width, height: size.height };
  } catch (error) {
    if (isNotImplemented(error)) return fallback;
    throw error;
  }
}

/**
 * The card a dragged catalog row would become, previewed while it's over the sheet (Flow 3 step 1, IR L55): a
 * ghost showing the snapped position and "x · y". Only a preview: the drop target and the placing are in
 * `drop-target.ts`, which is there before this chunk loads.
 */
export function DropGhost() {
  const preview = useDropPreview();
  const facet = preview?.facet;
  const size = useMemo(() => (facet === undefined ? null : ghostSize(facet)), [facet]);
  if (!preview || !size) return null;
  return (
    <ViewportPortal>
      <div
        className={styles.ghost}
        data-drop-ghost={preview.facet}
        aria-hidden="true"
        style={{ transform: `translate(${preview.at.x}px, ${preview.at.y}px)`, width: size.width, height: size.height }}
      >
        <span className={styles.coordinates}>{`${preview.at.x} · ${preview.at.y}`}</span>
      </div>
    </ViewportPortal>
  );
}
