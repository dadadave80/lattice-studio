import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { cx } from "../shared/cx";
import { dragSize, splitterKey, type PaneSide, type SplitterOrientation } from "./splitter-model";
import styles from "./Splitter.module.css";

export type SplitterProps = {
  /** The accessible name: "Resize left pane". */
  label: string;
  /** The id of the pane this splitter resizes. */
  controls: string;
  /** "vertical" sits between side-by-side panes (← →); "horizontal" sits above or below a pane (↑ ↓). */
  orientation: SplitterOrientation;
  /** The pane's size in px. */
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Which side of the splitter the pane is on: "before" is left of or above it. */
  paneSide: PaneSide;
  /** Arrow step in px (default 8, the grid). */
  step?: number;
  /** Shift + arrow step in px (default 32). */
  largeStep?: number;
  collapsed?: boolean;
  /** Enter toggles collapse when this is set. */
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string | undefined;
};

type Drag = { pointerId: number; start: number; origin: number };

/**
 * A pane splitter (APG window splitter): focusable `role="separator"` with the pane size as its value. Arrows
 * resize by `step` (Shift: `largeStep`), Home and End go to the bounds, Enter collapses or restores, and a drag
 * resizes. The hit area is 24 px wide around a hairline.
 */
export function Splitter({
  label, controls, orientation, value, min, max, onChange, paneSide, step = 8, largeStep = 32, collapsed = false,
  onCollapsedChange, className,
}: SplitterProps) {
  const drag = useRef<Drag | null>(null);
  const bounds = { min, max };

  const resize = (next: number) => {
    if (collapsed) onCollapsedChange?.(false);
    if (next !== value) onChange(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const result = splitterKey(event.key, event.shiftKey, {
      value, min, max, orientation, paneSide, step, largeStep,
    });
    if (!result) return;
    if (result.kind === "toggle") {
      if (!onCollapsedChange) return;
      event.preventDefault();
      onCollapsedChange(!collapsed);
      return;
    }
    event.preventDefault();
    resize(result.value);
  };

  const axis = (event: PointerEvent<HTMLDivElement>) => (orientation === "vertical" ? event.clientX : event.clientY);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // An inactive pointer id (synthetic events) can't be captured; the drag still works while over the splitter.
    }
    drag.current = { pointerId: event.pointerId, start: collapsed ? min : value, origin: axis(event) };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    resize(dragSize(current.start, axis(event) - current.origin, paneSide, bounds));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div
      // A focusable separator with a value is the APG window splitter; an <hr> can't draw the 24 px hit area.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-controls={controls}
      aria-orientation={orientation}
      aria-valuenow={collapsed ? min : value}
      aria-valuemin={min}
      aria-valuemax={max}
      {...(collapsed ? { "aria-valuetext": "Collapsed" } : {})}
      data-orientation={orientation}
      data-collapsed={collapsed ? "" : undefined}
      className={cx(styles.splitter, className)}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  );
}
