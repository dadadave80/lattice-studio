import type { Hex4 } from "@lattice-studio/core";
import { useReactFlow, useStoreApi, type OnMove } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { doc, getAnalysis, getCatalog, loadViewport, session, useDocument, type Viewport } from "@/contracts";
import { cardSizes, cardsBounds } from "./geometry";
import { attachSheet, sheetSize, storeViewport } from "./sheet-view";
import { FIT_MAX_ZOOM, fitRect, isViewport, sameViewport } from "./viewport-math";

const START: Viewport = { x: 0, y: 0, zoom: 1 };

/** Where a project with no stored viewport opens: every card in view, or the origin for an empty sheet. */
function firstViewport(): Viewport {
  const layout = doc.get().layout;
  const bounds = cardsBounds(layout, cardSizes(layout, getCatalog(), getAnalysis()));
  return bounds ? fitRect(bounds, sheetSize(), { maxZoom: FIT_MAX_ZOOM }) : START;
}

export type ViewportSync = {
  /** The viewport the sheet opens at, when the session already holds it (no flash of the origin). */
  initial: Viewport | undefined;
  /** True until the open project's viewport is applied; the sheet hides its cards meanwhile. */
  restoring: boolean;
  onMoveEnd: OnMove;
};

/**
 * The viewport belongs to the project (spec L402, PA L14): kept in the session per project id and saved per
 * project through `saveViewport` (S7a). When a project opens, the sheet restores the session's viewport, else
 * the saved one (`loadViewport`), else fits; after every pan or zoom it stores the result. Pane changes never
 * touch it: the sheet stays mounted and React Flow keeps its transform when its box resizes. A viewport
 * stored from elsewhere (a command run while the sheet was hidden, a test) is followed.
 *
 * Also attaches the sheet to `sheet-view.ts`, so commands and neighbors move this view.
 */
export function useViewportSync(wrapper: RefObject<HTMLElement | null>): ViewportSync {
  const flow = useReactFlow();
  const store = useStoreApi();
  const projectId = useDocument((s) => s.project.id);
  const [initial] = useState(() => session.get().viewports[projectId]);
  const [restored, setRestored] = useState<string | null>(null);
  /** The project whose viewport React Flow shows; null while one is being restored. */
  const active = useRef<string | null>(null);
  /** The last viewport asked for or stored, so our own writes aren't followed back. */
  const known = useRef<Viewport | null>(null);
  /** A glide's target and when it lands, so reads during the glide see where it's going. */
  const gliding = useRef<{ to: Viewport; until: number } | null>(null);

  useEffect(() => {
    const live = (): Viewport => {
      const [x, y, zoom] = store.getState().transform;
      return { x, y, zoom };
    };
    return attachSheet({
      viewport: () => {
        const glide = gliding.current;
        return glide && performance.now() < glide.until ? glide.to : live();
      },
      size: () => ({ width: wrapper.current?.clientWidth ?? 0, height: wrapper.current?.clientHeight ?? 0 }),
      element: () => wrapper.current,
      setViewport: (viewport, duration) => {
        known.current = viewport;
        gliding.current = duration > 0 ? { to: viewport, until: performance.now() + duration } : null;
        void flow.setViewport(viewport, { duration });
      },
      pinY: (facet: string, selector: Hex4) => {
        const handle = flow.getInternalNode(facet)?.internals.handleBounds?.source?.find((h) => h.id === selector);
        return handle ? handle.y + handle.height / 2 : null;
      },
    });
  }, [flow, store, wrapper]);

  useEffect(() => {
    let cancelled = false;
    active.current = null;
    const apply = (viewport: Viewport) => {
      if (cancelled) return;
      known.current = viewport;
      gliding.current = null;
      void flow.setViewport(viewport);
      active.current = projectId;
      storeViewport(projectId, viewport);
      setRestored(projectId);
    };
    const held = session.get().viewports[projectId];
    if (held) {
      apply(held);
    } else {
      const settle = (saved: unknown) => apply(session.get().viewports[projectId] ?? (isViewport(saved) ? saved : firstViewport()));
      loadViewport(projectId).then(settle, () => settle(null));
    }
    return () => {
      cancelled = true;
    };
  }, [flow, projectId]);

  useEffect(
    () =>
      session.subscribe((state, previous) => {
        if (state.viewports === previous.viewports) return;
        const id = active.current;
        const next = id === null ? undefined : state.viewports[id];
        if (!next || (known.current && sameViewport(next, known.current))) return;
        known.current = next;
        gliding.current = null;
        void flow.setViewport(next);
      }),
    [flow],
  );

  const onMoveEnd = useCallback<OnMove>(
    (_event, viewport) => {
      const id = active.current;
      if (id === null) return;
      const [x, y, zoom] = store.getState().transform;
      // A late end from before a newer move: the view has already gone elsewhere.
      if (!sameViewport(viewport, { x, y, zoom })) return;
      known.current = viewport;
      storeViewport(id, { x: viewport.x, y: viewport.y, zoom: viewport.zoom });
    },
    [store],
  );

  return { initial, restoring: restored !== projectId, onMoveEnd };
}
