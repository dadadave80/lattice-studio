/**
 * The sheet as the catalog's drop target, part of the interactions layer's shell (`InteractionsLayer`, loaded
 * with the canvas), not of the lazy overlays: a row dropped before the overlays' chunk has loaded still runs
 * `facet.place` at the drop point (Flow 3). The ghost only previews: it reads `useDropPreview` when it mounts.
 */
import type { Point } from "@lattice-studio/core";
import { useStore, type ReactFlowState } from "@xyflow/react";
import { useEffect, useSyncExternalStore } from "react";
import { commandRef, layoutMetrics, registerDropTarget, runCommand, type CatalogDrag } from "@/contracts";
import { snapPoint } from "./geometry";
import { toSheet } from "./sheet-space";

/** Where the dragged row would land: the facet and the snapped point. */
export type DropPreview = { facet: string; at: Point };

let preview: DropPreview | null = null;
const listeners = new Set<() => void>();

function show(next: DropPreview | null): void {
  preview = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The drop in progress over the sheet, if any. */
export function useDropPreview(): DropPreview | null {
  return useSyncExternalStore(subscribe, () => preview, () => null);
}

/**
 * Where a dragged catalog row lands: the pointer holds the card by the middle of its header, snapped to 8 px
 * (Flow 3). The command places it there, or in the nearest free slot when that's taken.
 */
export function landingPoint(drag: CatalogDrag, root: HTMLElement): Point {
  const p = toSheet({ x: drag.clientX, y: drag.clientY }, root);
  return snapPoint({ x: p.x - layoutMetrics.cardWidth / 2, y: p.y - layoutMetrics.headerHeight / 2 }, layoutMetrics.snap);
}

const domNodeOf = (s: ReactFlowState) => s.domNode;

/**
 * Registers the sheet (React Flow's root) as the drop target while the layer is mounted: releasing a dragged
 * row places the facet there (`facet.place`, which says why when it can't), and releasing anywhere else cancels.
 */
export function useSheetDropTarget(): void {
  const root = useStore(domNodeOf);
  useEffect(() => {
    if (!root) return undefined;
    const stop = registerDropTarget({
      element: root,
      over: (drag) => show({ facet: drag.facet, at: landingPoint(drag, root) }),
      leave: () => show(null),
      drop: (drag) => {
        show(null);
        void runCommand(commandRef("facet.place", { facet: drag.facet, at: landingPoint(drag, root) }), "button");
      },
    });
    // Says the sheet takes drops now (the e2e drags once it does).
    root.setAttribute("data-drop-target", "ready");
    return () => {
      root.removeAttribute("data-drop-target");
      stop();
      show(null);
    };
  }, [root]);
}
