import type { Point, Size } from "@lattice-studio/core";
import { cardSize, contestedSelectors, isNotImplemented } from "@lattice-studio/core";
import { useStore, ViewportPortal, type ReactFlowState } from "@xyflow/react";
import { useEffect, useState } from "react";
import {
  commandRef, getAnalysis, getCatalog, layoutMetrics, registerDropTarget, runCommand, type CatalogDrag,
} from "@/contracts";
import { snapPoint } from "./geometry";
import { toSheet } from "./sheet-space";
import styles from "./interact.module.css";

const domNodeOf = (s: ReactFlowState) => s.domNode;

type Ghost = { facet: string; at: Point; size: Size };

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
 * Where a dragged catalog row lands: the pointer holds the card by the middle of its header, snapped to 8 px
 * (Flow 3). The command places it there, or in the nearest free slot when that's taken.
 */
function landingPoint(drag: CatalogDrag, root: HTMLElement): Point {
  const p = toSheet({ x: drag.clientX, y: drag.clientY }, root);
  return snapPoint({ x: p.x - layoutMetrics.cardWidth / 2, y: p.y - layoutMetrics.headerHeight / 2 }, layoutMetrics.snap);
}

/**
 * The sheet as the catalog's drop target (Flow 3 step 1, IR L55): while a row is dragged over it, a ghost of
 * the card shows the snapped position and "x · y"; releasing places the facet there (`facet.place`), and
 * releasing anywhere else cancels.
 */
export function DropGhost() {
  const root = useStore(domNodeOf);
  const [ghost, setGhost] = useState<Ghost | null>(null);

  useEffect(() => {
    if (!root) return undefined;
    const size = new Map<string, Size>();
    const sized = (facet: string) => {
      const known = size.get(facet);
      if (known) return known;
      const next = ghostSize(facet);
      size.set(facet, next);
      return next;
    };
    return registerDropTarget({
      element: root,
      over: (drag) => setGhost({ facet: drag.facet, at: landingPoint(drag, root), size: sized(drag.facet) }),
      leave: () => setGhost(null),
      drop: (drag) => {
        setGhost(null);
        void runCommand(commandRef("facet.place", { facet: drag.facet, at: landingPoint(drag, root) }), "button");
      },
    });
  }, [root]);

  if (!ghost) return null;
  return (
    <ViewportPortal>
      <div
        className={styles.ghost}
        data-drop-ghost={ghost.facet}
        aria-hidden="true"
        style={{ transform: `translate(${ghost.at.x}px, ${ghost.at.y}px)`, width: ghost.size.width, height: ghost.size.height }}
      >
        <span className={styles.coordinates}>{`${ghost.at.x} · ${ghost.at.y}`}</span>
      </div>
    </ViewportPortal>
  );
}
