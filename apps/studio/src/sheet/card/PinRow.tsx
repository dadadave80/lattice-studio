import type { CommandRef } from "@lattice-studio/core";
import { memo, useId, type MouseEvent, type ReactNode } from "react";
import { runCommand, useCommandState } from "@/contracts";
import { Icon } from "@/ui/icons/Icon";
import { cx } from "@/ui/shared/cx";
import { hatchedClass } from "@/ui/status/hatch";
import { ReasonTooltip } from "@/ui/tooltip/ReasonTooltip";
import type { PinView } from "./card-model";
import styles from "./FacetCard.module.css";

export type PinRowProps = {
  pin: PinView;
  side: "left" | "right";
};

/** What the tooltip says a click does (Flow 6), with the signature as code. */
function tooltipContent(pin: PinView): ReactNode {
  return (
    <>
      {pin.tooltip.code ? <code>{pin.tooltip.code}</code> : null}
      {pin.tooltip.text}
    </>
  );
}

/** Stands in for a pin with no action, so the hook runs unconditionally; its state is never used. */
function refOf(pin: PinView): CommandRef {
  return pin.action ?? { id: "selector.exclude", args: { selector: pin.selector } };
}

/**
 * One selector row (IR L104): tick, node, name, and the hex or who serves it. A click or Space does what the
 * tooltip says through the command registry; it never changes the selection (IR L47). When the command can't
 * run (read-only, a module not built yet) the row is disabled with the command's reason; a seam offers no
 * route, so its row is disabled with the seam's reason. Rows are reached by S4e's roving focus
 * (`data-card-row`); `nodrag` keeps a press on a pin from dragging the card, while a Hand-tool drag still pans.
 */
export const PinRow = memo(function PinRow({ pin, side }: PinRowProps) {
  const describedBy = useId();
  const command = useCommandState(refOf(pin));
  const reason = pin.action === null ? pin.tooltip.text : command.ok ? null : command.reason;
  const run = (event: MouseEvent) => {
    event.stopPropagation();
    if (pin.action) void runCommand(pin.action, "button");
  };
  const row = (
    <button
      type="button"
      tabIndex={-1}
      className={cx(
        styles.pin, styles[pin.state], pin.here && styles.here, side === "right" && styles.pinRight,
        pin.state === "contested" && hatchedClass, "nodrag",
      )}
      data-card-row=""
      data-selector={pin.selector}
      data-state={pin.state}
      aria-label={pin.label}
      aria-describedby={pin.action === null ? undefined : describedBy}
      onClick={run}
    >
      <span className={styles.tick} aria-hidden="true">
        <span className={styles.node} />
      </span>
      <span className={cx(styles.label, pin.mark !== pin.selector && styles.labelLong)} aria-hidden="true">
        <span className={styles.name}>{pin.name}</span>
        {pin.state === "seam" ? <Icon name="lock" size="small" className={styles.lock} /> : null}
        {pin.state === "default" ? <span className={styles.dot} /> : null}
        <span className={styles.mark}>{pin.mark}</span>
      </span>
      {pin.action === null ? null : (
        <span id={describedBy} hidden>
          {pin.tooltip.code ? `${pin.tooltip.code}${pin.tooltip.text}` : pin.tooltip.text}
        </span>
      )}
    </button>
  );
  return (
    <ReasonTooltip
      reason={reason}
      content={pin.action === null ? undefined : tooltipContent(pin)}
      side={side === "right" ? "right" : "left"}
    >
      {row}
    </ReasonTooltip>
  );
});
