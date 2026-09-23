import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useId } from "react";
import { cx } from "../shared/cx";
import { ReasonTooltip } from "../tooltip/ReasonTooltip";
import styles from "./Toggle.module.css";

export type SegmentedOption<V extends string = string> = {
  value: V;
  /** Sentence-case text; it is the option's accessible name ("Shop", "Draft"). */
  label: string;
};

export type SegmentedToggleProps<V extends string = string> = {
  /** The group's accessible name ("Theme"). */
  label: string;
  value: V;
  onValueChange: (value: V) => void;
  options: readonly SegmentedOption<V>[];
  /**
   * Why the choice can't change now. While set the group and each option have `aria-disabled` and are
   * described by the reason, the options stay focusable, the reason shows in a tooltip, and nothing changes
   * (spec L661).
   */
  disabledReason?: string | null | undefined;
  className?: string | undefined;
};

/**
 * One choice from two or three short options, side by side (the title bar's Shop / Draft switch). Arrow keys
 * move between options and Space or Enter picks one. There is always exactly one pressed.
 */
export function SegmentedToggle<V extends string = string>({
  label, value, onValueChange, options, disabledReason, className,
}: SegmentedToggleProps<V>) {
  const reasonId = useId();
  // Focus lands on an option, not the group, so each option says it's unavailable and why.
  const optionState = disabledReason ? { "aria-disabled": true, "aria-describedby": reasonId } : {};
  return (
    <ReasonTooltip reason={disabledReason}>
      <ToggleGroup
        aria-label={label}
        value={[value]}
        onValueChange={(next, details) => {
          const picked = options.find((o) => next.includes(o.value) && o.value !== value);
          if (disabledReason || !picked) {
            details.cancel();
            return;
          }
          onValueChange(picked.value);
        }}
        className={cx(styles.segmented, className)}
      >
        {options.map((option) => (
          <Toggle
            key={option.value}
            value={option.value}
            {...optionState}
            className={cx(styles.segment, styles.pressedMark)}
          >
            {option.label}
          </Toggle>
        ))}
        {disabledReason ? (
          <span id={reasonId} hidden>
            {disabledReason}
          </span>
        ) : null}
      </ToggleGroup>
    </ReasonTooltip>
  );
}
