import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { commandRef, pushEscape, runCommand } from "@/contracts";
import { cx } from "@/ui/shared/cx";
import { BadgeFace, type BadgeProps } from "./BadgeFace";
import styles from "./InitBadge.module.css";

/** A press has to travel this far before it's a drag (the card drag's threshold, spec L473). */
const DRAG_THRESHOLD_PX = 4;
const DROP_ATTRIBUTE = "data-init-drop";

type Drag = { pointer: number; startX: number; startY: number; x: number; y: number; moved: boolean };

/** The card under a point, and the recipe step its badge stands for, ignoring the dragged badge's own card. */
export function dropTargetAt(x: number, y: number, from: Element | null): { card: HTMLElement; index: number } | null {
  for (const element of document.elementsFromPoint(x, y)) {
    const card = element.closest<HTMLElement>(".react-flow__node[data-id]");
    if (!card || (from && card.contains(from))) continue;
    const badge = card.querySelector<HTMLElement>("[data-init-index]");
    const index = Number(badge?.dataset.initIndex);
    return badge && Number.isSafeInteger(index) ? { card, index } : null;
  }
  return null;
}

/** Pointer capture keeps the drag's moves on the badge; a pointer the browser no longer tracks just can't be captured. */
function capture(element: Element, pointer: number, on: boolean): void {
  try {
    if (on) element.setPointerCapture(pointer);
    else if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer);
  } catch {
    // InvalidPointerId: the moves still arrive while the pointer stays over the badge's page.
  }
}

function markDrop(card: HTMLElement | null): void {
  for (const marked of document.querySelectorAll(`[${DROP_ATTRIBUTE}]`)) if (marked !== card) marked.removeAttribute(DROP_ATTRIBUTE);
  card?.setAttribute(DROP_ATTRIBUTE, "");
}

/**
 * The init badge with dragging (Flow 7 step 5): drag a step's badge onto another step's card and the step moves
 * to that place, one undo step through `init.moveStep`, which narrates it. A badge whose order is fixed (a
 * bundle, the automatic step) is only drawn. The ↑/↓ buttons in the step list and Alt+↑↓ in the Structure tree
 * are the single-pointer and keyboard ways (spec L761), so the badge itself takes no focus.
 */
export function InitBadge(props: BadgeProps) {
  const { index } = props;
  const face = useRef<HTMLSpanElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const dragging = drag?.moved === true;

  useEffect(() => () => markDrop(null), []);
  // Esc drops nothing and keeps init order mode on: the drag takes it before the mode does.
  useEffect(() => {
    if (!dragging) return;
    return pushEscape(() => {
      setDrag(null);
      markDrop(null);
      return true;
    });
  }, [dragging]);

  if (index === null) return <BadgeFace {...props} />;

  const end = (event: ReactPointerEvent<HTMLSpanElement>, drop: boolean) => {
    if (!drag || event.pointerId !== drag.pointer) return;
    event.stopPropagation();
    if (face.current) capture(face.current, event.pointerId, false);
    setDrag(null);
    markDrop(null);
    if (!drop || !drag.moved) return;
    const target = dropTargetAt(event.clientX, event.clientY, face.current);
    if (target && target.index !== index) {
      void runCommand(commandRef("init.moveStep", { path: `steps[${index}]`, to: target.index }), "button");
    }
  };

  return (
    <>
      <BadgeFace
        {...props}
        ref={face}
        // React Flow leaves an element with these classes alone: no card drag, no pan, no wheel zoom.
        className={cx("nodrag", "nopan", styles.movable, dragging && styles.dragging)}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          event.preventDefault();
          capture(event.currentTarget, event.pointerId, true);
          const { clientX: x, clientY: y } = event;
          setDrag({ pointer: event.pointerId, startX: x, startY: y, x, y, moved: false });
        }}
        onPointerMove={(event) => {
          if (!drag || event.pointerId !== drag.pointer) return;
          event.stopPropagation();
          const { clientX: x, clientY: y } = event;
          const moved = drag.moved || Math.hypot(x - drag.startX, y - drag.startY) >= DRAG_THRESHOLD_PX;
          setDrag({ ...drag, x, y, moved });
          if (moved) markDrop(dropTargetAt(x, y, face.current)?.card ?? null);
        }}
        onPointerUp={(event) => end(event, true)}
        onPointerCancel={(event) => end(event, false)}
        onClick={(event) => event.stopPropagation()}
      />
      {drag && dragging
        ? createPortal(
            <BadgeFace {...props} aria-hidden="true" className={styles.ghost} style={{ left: drag.x, top: drag.y }} />,
            document.body,
          )
        : null}
    </>
  );
}
