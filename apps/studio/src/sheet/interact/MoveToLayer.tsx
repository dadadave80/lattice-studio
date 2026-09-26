import type { Point, Rect } from "@lattice-studio/core";
import { useStore, ViewportPortal, type ReactFlowState } from "@xyflow/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { announce, doc, layoutMetrics, pushEscape, session, settings, useDocument, useSession } from "@/contracts";
import { isTypingTarget } from "@/commands/keys/key-context";
import { positionInWords } from "@/a11y/positions";
import { panSheet, sheetSize, sheetViewport } from "@/sheet/canvas/sheet-view";
import { directionVector, groupBounds, rectOf, snapPoint, without } from "./geometry";
import { cancelMoveTo, dropMoveTo } from "./move-to";
import { cardsWord } from "./moves";
import { placedSelection } from "./selection";
import { currentSizes, toSheet } from "./sheet-space";
import styles from "./interact.module.css";

const domNodeOf = (s: ReactFlowState) => s.domNode;

const ARROWS: Readonly<Record<string, "left" | "right" | "up" | "down">> = {
  ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
};

/** Screen px kept between the crosshair's ghost and the sheet's edge when the arrows move it. */
const EDGE_MARGIN = 24;

/**
 * While Move to… is on, the arrows and Enter belong to the crosshair wherever focus is (it starts from the
 * Structure tree and the inspector too), except in a text field, an open menu or a dialog.
 */
function crosshairTakes(target: EventTarget | null): boolean {
  if (session.get().dialogs.length > 0) return false;
  if (!(target instanceof Element)) return true;
  if (isTypingTarget(target)) return false;
  return target.closest('[role="menu"], [role="dialog"], [role="alertdialog"]') === null;
}

/** Pans so `rect` (sheet units) shows inside the sheet, `EDGE_MARGIN` from its edges. */
function keepInView(rect: Rect): void {
  const v = sheetViewport();
  const size = sheetSize();
  const left = rect.x * v.zoom + v.x;
  const top = rect.y * v.zoom + v.y;
  const right = left + Math.min(rect.width * v.zoom, size.width - 2 * EDGE_MARGIN);
  const bottom = top + Math.min(rect.height * v.zoom, size.height - 2 * EDGE_MARGIN);
  const dx = left < EDGE_MARGIN ? EDGE_MARGIN - left : right > size.width - EDGE_MARGIN ? size.width - EDGE_MARGIN - right : 0;
  const dy = top < EDGE_MARGIN ? EDGE_MARGIN - top : bottom > size.height - EDGE_MARGIN ? size.height - EDGE_MARGIN - bottom : 0;
  if (dx !== 0 || dy !== 0) panSheet(dx, dy);
}

/**
 * Move to… (Flow 8, IR L44): while it's on, a ghost of the selection follows the pointer over the sheet and a
 * click drops it there; or the arrows move a crosshair (by the Nudge step, Shift for the large one) and Enter
 * drops it. Esc cancels. Nothing is dragged: a single click or the keyboard moves the cards (WCAG 2.5.7).
 */
export function MoveToLayer() {
  const active = useSession((s) => s.modes.moveTo);
  if (!active) return null;
  return <MoveToGhost />;
}

function MoveToGhost() {
  const root = useStore(domNodeOf);
  const layout = useDocument((s) => s.project.layout);
  const selection = useSession((s) => s.selection);
  const names = useMemo(() => placedSelection(layout, selection), [layout, selection]);
  const [sizes] = useState(currentSizes);
  const bounds = useMemo(() => groupBounds(layout, sizes, names, layoutMetrics), [layout, sizes, names]);
  const [target, setTarget] = useState<Point | null>(() => (bounds ? { x: bounds.x, y: bounds.y } : null));
  const targetRef = useRef(target);

  useEffect(() => {
    if (!root || !bounds) return undefined;
    /** Where the pointer holds the group: the middle of the first card's header. */
    const grip = { x: Math.min(bounds.width, layoutMetrics.cardWidth) / 2, y: layoutMetrics.headerHeight / 2 };
    const at = (event: MouseEvent): Point => {
      const p = toSheet({ x: event.clientX, y: event.clientY }, root);
      return snapPoint({ x: p.x - grip.x, y: p.y - grip.y }, layoutMetrics.snap);
    };
    const drop = (to: Point) => dropMoveTo({ x: to.x - bounds.x, y: to.y - bounds.y });
    const place = (next: Point) => {
      targetRef.current = next;
      setTarget(next);
    };

    const move = (event: PointerEvent) => place(at(event));
    // A press on the sheet belongs to Move to…: it neither drags, selects nor pans.
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const click = (event: MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      drop(at(event));
    };
    const key = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || !crosshairTakes(event.target)) return;
      const dir = ARROWS[event.key];
      const now = targetRef.current;
      if (dir && now) {
        event.preventDefault();
        event.stopPropagation();
        const nudge = settings.get().nudge;
        const by = directionVector(dir, event.shiftKey ? nudge.large : nudge.small);
        const next = { x: now.x + by.x, y: now.y + by.y };
        place(next);
        keepInView({ ...bounds, x: next.x, y: next.y });
        announce(ghostWords(names, next, bounds), { merge: "move-to" });
        return;
      }
      if (event.key === "Enter" && !event.shiftKey && now) {
        event.preventDefault();
        event.stopPropagation();
        drop(now);
      }
    };

    root.setAttribute("data-placing", "");
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerdown", down, true);
    root.addEventListener("click", click, true);
    window.addEventListener("keydown", key, true);
    const release = pushEscape(() => {
      cancelMoveTo();
      return true;
    });
    return () => {
      root.removeAttribute("data-placing");
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerdown", down, true);
      root.removeEventListener("click", click, true);
      window.removeEventListener("keydown", key, true);
      release();
    };
  }, [root, bounds, names]);

  if (!bounds || !target) return null;
  const dx = target.x - bounds.x;
  const dy = target.y - bounds.y;
  return (
    <ViewportPortal>
      <div data-move-to="" aria-hidden="true">
        {names.map((name) => {
          const r = rectOf(layout, sizes, name, layoutMetrics);
          if (!r) return null;
          return (
            <div
              key={name}
              className={styles.ghost}
              style={{ transform: `translate(${r.x + dx}px, ${r.y + dy}px)`, width: r.width, height: r.height }}
            />
          );
        })}
        <div className={styles.crosshair} style={{ transform: `translate(${target.x}px, ${target.y}px)` }}>
          <span className={styles.coordinates}>{`${target.x} · ${target.y}`}</span>
        </div>
      </div>
    </ViewportPortal>
  );
}

/** Where the ghost is, in words, for the arrows: "Moving ERC20, beside ERC4626." */
function ghostWords(names: readonly string[], target: Point, bounds: Rect): string {
  const layout = doc.get().layout;
  const first = names[0];
  const entry = first === undefined ? undefined : layout[first];
  if (first === undefined || !entry) return `Moving ${cardsWord(names)}.`;
  const moved = { ...entry, x: entry.x + target.x - bounds.x, y: entry.y + target.y - bounds.y };
  const where = positionInWords(first, { ...without(layout, names), [first]: moved });
  return where ? `Moving ${cardsWord(names)}, ${where}.` : `Moving ${cardsWord(names)}.`;
}
