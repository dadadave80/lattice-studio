import type { Layout, Sizes } from "@lattice-studio/core";
import { useStore, type ReactFlowState } from "@xyflow/react";
import { useEffect, useState } from "react";
import { doc, layoutMetrics, session } from "@/contracts";
import { DRAG_THRESHOLD, marqueeHits, spanRect, union } from "./geometry";
import { select } from "./selection";
import { currentSizes, toLocal, toSheet } from "./sheet-space";
import styles from "./interact.module.css";

const domNodeOf = (s: ReactFlowState) => s.domNode;

type Box = { left: number; top: number; width: number; height: number };

function onPane(target: EventTarget | null): boolean {
  return target instanceof Element && target.classList.contains("react-flow__pane");
}

/** Hand tool, Space held or Move to… placing: a press on empty sheet isn't a marquee. */
function busy(root: HTMLElement): boolean {
  const s = session.get();
  return s.tool === "hand" || s.modes.moveTo || root.closest("[data-panning]") !== null;
}

/**
 * The marquee (IR L49-L50): with the Select tool, a drag on empty sheet draws a rectangle; the cards it touches
 * are selected as it goes (so they highlight live) and stay selected on release. Shift adds to the selection
 * there was. A click on empty sheet clears the selection (Shift-click leaves it). Esc during the drag puts the
 * selection back. One finger on a touch screen draws it too; two fingers still pan and pinch.
 */
export function Marquee() {
  const root = useStore(domNodeOf);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    if (!root) return undefined;
    let drag: {
      pointerId: number;
      start: { x: number; y: number };
      startSheet: { x: number; y: number };
      before: string[];
      /** The cards and their sizes when the marquee started: nothing moves while it's drawn. */
      layout: Layout;
      sizes: Sizes;
      base: string[];
      moved: boolean;
      shift: boolean;
    } | null = null;

    const down = (event: PointerEvent) => {
      if (drag && !event.isPrimary) {
        // A second finger: this is a pinch or a two-finger pan, not a marquee.
        const { before } = drag;
        drag = null;
        setBox(null);
        select(before, { quiet: true });
        return;
      }
      if (event.button !== 0 || !event.isPrimary || !onPane(event.target) || busy(root)) return;
      const client = { x: event.clientX, y: event.clientY };
      const before = session.get().selection;
      drag = {
        pointerId: event.pointerId,
        start: toLocal(client, root),
        startSheet: toSheet(client, root),
        before,
        layout: doc.get().layout,
        sizes: currentSizes(),
        base: event.shiftKey ? before : [],
        moved: false,
        shift: event.shiftKey,
      };
      try {
        // Moves outside the sheet keep drawing it.
        (event.target as Element).setPointerCapture(event.pointerId);
      } catch {
        // Not an active pointer (a synthetic one): the window listeners still follow it.
      }
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const client = { x: event.clientX, y: event.clientY };
      const local = toLocal(client, root);
      if (!drag.moved && Math.hypot(local.x - drag.start.x, local.y - drag.start.y) <= DRAG_THRESHOLD) return;
      drag.moved = true;
      const rect = spanRect(drag.start, local);
      setBox({ left: rect.x, top: rect.y, width: rect.width, height: rect.height });
      const hits = marqueeHits(drag.layout, drag.sizes, spanRect(drag.startSheet, toSheet(client, root)), layoutMetrics);
      select(union(drag.base, hits));
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const { moved, shift } = drag;
      drag = null;
      setBox(null);
      // A click on empty sheet clears the selection; Shift-click keeps it. It deselects the core too: `select([])`
      // writes nothing when nothing is selected, and only a selection write clears `coreSelected` by itself.
      if (!moved && !shift) {
        select([]);
        if (session.get().coreSelected) session.set({ coreSelected: false });
      }
    };
    const cancel = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const { before } = drag;
      drag = null;
      setBox(null);
      select(before);
    };
    const key = (event: KeyboardEvent) => {
      if (!drag || event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      const { before } = drag;
      drag = null;
      setBox(null);
      select(before);
    };
    /**
     * One finger on empty sheet draws the marquee, so React Flow's touch panning mustn't see it land. When a second
     * finger follows, its touchstart goes through: d3-zoom starts from every finger down (`event.touches`), so it
     * pinches and pans with both even though it never saw the first land.
     */
    const touch = (event: TouchEvent) => {
      if (event.touches.length === 1 && onPane(event.target) && !busy(root)) event.stopPropagation();
    };

    root.addEventListener("pointerdown", down);
    root.addEventListener("touchstart", touch, { capture: true, passive: true });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    return () => {
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("touchstart", touch, { capture: true });
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
    };
  }, [root]);

  if (!box) return null;
  return <div className={styles.marquee} style={box} data-marquee="" aria-hidden="true" />;
}
