import type { CommandRef } from "@lattice-studio/core";
import { memo, useId, type MouseEvent, type ReactNode } from "react";
import { commandRef, runCommand, useCommandState } from "@/contracts";
import { Icon } from "@/ui/icons/Icon";
import { cx } from "@/ui/shared/cx";
import { hatchedClass } from "@/ui/status/hatch";
import { ReasonTooltip } from "@/ui/tooltip/ReasonTooltip";
import type { PinView } from "./card-model";
import styles from "./FacetCard.module.css";

export type PinRowProps = {
  facet: string;
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

const ROUTE = {
  routed: { icon: "check", label: "Leave out of the diamond" },
  excluded: { icon: "plus", label: "Bring back" },
  elsewhere: { icon: "arrow-right", label: "Route here" },
  contested: { icon: "arrow-right", label: "Route here" },
  default: { icon: "more", label: "Change owner" },
  seam: { icon: "lock", label: "Routing locked" },
  unchecked: { icon: "more", label: "Not checked yet" },
} as const;

/** Inspect the facet's selectors separately from routing; both actions use the existing row navigation. */
export const PinRow = memo(function PinRow({ facet, pin, side }: PinRowProps) {
  const describedBy = useId();
  const command = useCommandState(refOf(pin));
  const reason = pin.action === null ? pin.tooltip.text : command.ok ? null : command.reason;
  const route = ROUTE[pin.state];
  const stopDoubleClick = (event: MouseEvent) => event.stopPropagation();
  const inspect = (event: MouseEvent) => {
    event.stopPropagation();
    void runCommand(commandRef("inspector.focusSelectors", { facet }), "button");
  };
  const runRoute = (event: MouseEvent) => {
    event.stopPropagation();
    if (pin.action) void runCommand(pin.action, "button");
  };
  return (
    <div
      className={cx(
        styles.pin, styles[pin.state], pin.here && styles.here, side === "right" && styles.pinRight,
        pin.state === "contested" && hatchedClass, "nodrag",
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        className={cx(styles.inspect, "nodrag")}
        data-card-row=""
        data-selector={pin.selector}
        data-state={pin.state}
        aria-label={`Inspect ${pin.rowLabel}`}
        aria-describedby={pin.action === null ? describedBy : undefined}
        onClick={inspect}
        onDoubleClick={stopDoubleClick}
      >
        <span className={styles.tick} aria-hidden="true"><span className={styles.node} /></span>
        <span className={cx(styles.label, pin.mark !== pin.selector && styles.labelLong)} aria-hidden="true">
          <span className={styles.name}>{pin.name}</span>{" "}
          {pin.state === "seam" ? <Icon name="lock" size="small" className={styles.lock} /> : null}
          {pin.state === "default" ? <span className={styles.dot} /> : null}
          <span className={styles.mark}>{pin.mark}</span>
        </span>
        {pin.action === null ? <span id={describedBy} hidden>{pin.tooltip.text}</span> : null}
      </button>
      {pin.action === null ? (
        <span className={styles.route} title={pin.tooltip.text} aria-hidden="true">
          <Icon name={route.icon} size="small" />
        </span>
      ) : (
        <ReasonTooltip reason={reason} content={tooltipContent(pin)} side={side === "right" ? "right" : "left"}>
          <button
            type="button"
            tabIndex={-1}
            className={cx(styles.route, "nodrag")}
            data-card-row=""
            data-selector={pin.selector}
            data-state={pin.state}
            aria-label={`${route.label}: ${pin.signature}`}
            aria-describedby={describedBy}
            onClick={runRoute}
            onDoubleClick={stopDoubleClick}
          >
            <Icon name={route.icon} size="small" />
            <span id={describedBy} hidden>
              {pin.tooltip.code ? `${pin.tooltip.code}${pin.tooltip.text}` : pin.tooltip.text}
            </span>
          </button>
        </ReasonTooltip>
      )}
    </div>
  );
});
