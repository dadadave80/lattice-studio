import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { useId, type ReactNode } from "react";
import { cx } from "../shared/cx";
import { ReasonTooltip } from "../tooltip/ReasonTooltip";
import styles from "./Choice.module.css";

export type SwitchProps = {
  /** Sentence-case text beside the switch; it is the switch's accessible name ("Reduce motion"). */
  label: string;
  /** Controlled state. */
  checked?: boolean;
  /** Uncontrolled initial state. */
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Help under the label, set as the switch's description. */
  description?: ReactNode;
  /**
   * Why the switch can't be changed now ("Connect a wallet first"). While set it stays focusable with
   * `aria-disabled`, is described by the reason, shows it in a tooltip and never changes (spec L661).
   */
  disabledReason?: string | null | undefined;
  name?: string;
  className?: string | undefined;
};

/** An on/off setting that applies at once (`role="switch"`). Space toggles it; so does a click on its label. */
export function Switch({
  label, checked, defaultChecked, onCheckedChange, description, disabledReason, name, className,
}: SwitchProps) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className={cx(styles.choice, className)}>
      <label className={styles.row}>
        <ReasonTooltip reason={disabledReason}>
          <BaseSwitch.Root
            aria-labelledby={labelId}
            {...(description ? { "aria-describedby": descriptionId } : {})}
            {...(checked === undefined ? {} : { checked })}
            {...(defaultChecked === undefined ? {} : { defaultChecked })}
            {...(name ? { name } : {})}
            onCheckedChange={(next, details) => {
              if (disabledReason) {
                details.cancel();
                return;
              }
              onCheckedChange?.(next);
            }}
            className={styles.switch}
          >
            <BaseSwitch.Thumb className={styles.thumb} />
          </BaseSwitch.Root>
        </ReasonTooltip>
        <span id={labelId} className={styles.text}>
          {label}
        </span>
      </label>
      {description ? (
        <span id={descriptionId} className={cx(styles.description, styles.switchDescription)}>
          {description}
        </span>
      ) : null}
    </div>
  );
}
