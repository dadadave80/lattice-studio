import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { useId, type ReactNode } from "react";
import { Icon } from "../icons/Icon";
import { cx } from "../shared/cx";
import { ReasonTooltip } from "../tooltip/ReasonTooltip";
import styles from "./Choice.module.css";

export type CheckboxProps = {
  /**
   * Sentence-case text beside the box, which can be a whole sentence ("I understand this deploys unaudited
   * code"). It is the checkbox's accessible name.
   */
  label: string;
  /** Controlled state. */
  checked?: boolean;
  /** Uncontrolled initial state. */
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  /** Help under the label, set as the checkbox's description. */
  description?: ReactNode;
  /**
   * Why the box can't be ticked now ("Resolve 2 blockers · F8"). While set it stays focusable with
   * `aria-disabled`, is described by the reason, shows it in a tooltip and never changes (spec L661).
   */
  disabledReason?: string | null | undefined;
  name?: string;
  className?: string | undefined;
};

/** A tick box with a visible label: acknowledgements, opt-ins. Space toggles it; so does a click on its label. */
export function Checkbox({
  label, checked, defaultChecked, onCheckedChange, description, disabledReason, name, className,
}: CheckboxProps) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className={cx(styles.choice, className)}>
      <label className={styles.row}>
        <ReasonTooltip reason={disabledReason}>
          <BaseCheckbox.Root
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
            className={styles.box}
          >
            <BaseCheckbox.Indicator className={styles.indicator}>
              <Icon name="check" size="small" />
            </BaseCheckbox.Indicator>
          </BaseCheckbox.Root>
        </ReasonTooltip>
        <span id={labelId} className={styles.text}>
          {label}
        </span>
      </label>
      {description ? (
        <span id={descriptionId} className={styles.description}>
          {description}
        </span>
      ) : null}
    </div>
  );
}
