import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useId, useState } from "react";
import { cx } from "../shared/cx";
import { Tooltip } from "../tooltip/Tooltip";
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
   * Why the choice can't change now. While set the group and each option have `aria-disabled`, each option is
   * described by the reason (one hidden element, written once; the group isn't, so it's read once), the options
   * stay focusable, the reason shows
   * in a tooltip on hover, on focus and when a change is refused, and nothing changes (spec L661).
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
  const [reasonShown, setReasonShown] = useState(false);
  // A reason that went away closes its tooltip, so it can't reopen by itself when a reason comes back.
  if (!disabledReason && reasonShown) setReasonShown(false);
  // Focus lands on an option, not the group, so each option says it's unavailable and why, all pointing at the
  // one hidden reason. The group is only aria-disabled: describing it too would read the reason twice on entry.
  const described = disabledReason ? { "aria-disabled": true, "aria-describedby": reasonId } : {};
  // The tooltip always wraps the group (it never opens without a reason), so a reason coming or going doesn't
  // remount the options and take focus with them.
  return (
    <Tooltip
      content={disabledReason}
      open={Boolean(disabledReason) && reasonShown}
      onOpenChange={(open) => setReasonShown(open && Boolean(disabledReason))}
      closeOnClick={false}
    >
      <ToggleGroup
        aria-label={label}
        {...(disabledReason ? { "aria-disabled": true } : {})}
        value={[value]}
        onValueChange={(next, details) => {
          const picked = options.find((o) => next.includes(o.value) && o.value !== value);
          if (disabledReason || !picked) {
            details.cancel();
            if (disabledReason) setReasonShown(true);
            return;
          }
          onValueChange(picked.value);
        }}
        className={cx(styles.segmented, className)}
      >
        {options.map((option) => (
          <Toggle key={option.value} value={option.value} {...described} className={cx(styles.segment, styles.pressedMark)}>
            {option.label}
          </Toggle>
        ))}
        {disabledReason ? (
          <span id={reasonId} hidden>
            {disabledReason}
          </span>
        ) : null}
      </ToggleGroup>
    </Tooltip>
  );
}
