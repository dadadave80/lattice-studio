import { Select as BaseSelect } from "@base-ui/react/select";
import { useId, type ReactNode } from "react";
import { Icon } from "../icons/Icon";
import { cx } from "../shared/cx";
import { ReasonTooltip } from "../tooltip/ReasonTooltip";
import styles from "./Field.module.css";

export type SelectOption<V extends string = string> = {
  value: V;
  /** Sentence-case option text, shown in the trigger when picked. */
  label: string;
  /** A muted second line in the list. */
  description?: string;
};

export type SelectProps<V extends string = string> = {
  /** The small-caps field label; the trigger's accessible name ("Network"). */
  label: string;
  /** Keep the label for assistive technology only, when the context already shows it (a unit beside an amount). */
  hideLabel?: boolean;
  options: readonly SelectOption<V>[];
  /** Controlled value; null shows the placeholder. */
  value?: V | null;
  /** Uncontrolled initial value. */
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  /** Shown while nothing is picked ("Choose a network"). */
  placeholder?: string;
  /** Help under the field, set as the trigger's description. */
  description?: ReactNode;
  /**
   * Why the choice can't change now ("Connect a wallet first"). While set the trigger stays focusable with
   * `aria-disabled`, is described by the reason, shows it in a tooltip and never opens (spec L661).
   */
  disabledReason?: string | null | undefined;
  name?: string;
  className?: string | undefined;
  triggerClassName?: string | undefined;
};

/**
 * Pick one option from a list. Enter, Space or ↓ opens it, arrows move, Enter picks, Esc closes and focus
 * returns to the trigger. The list is a `list` key context: single-key shortcuts stay off inside it.
 */
export function Select<V extends string = string>({
  label, hideLabel = false, options, value, defaultValue, onValueChange, placeholder, description, disabledReason,
  name, className, triggerClassName,
}: SelectProps<V>) {
  const descriptionId = useId();
  return (
    <div className={cx(styles.field, className)}>
      <BaseSelect.Root<V>
        items={options}
        {...(value === undefined ? {} : { value })}
        {...(defaultValue === undefined ? {} : { defaultValue })}
        {...(name ? { name } : {})}
        onOpenChange={(open, details) => {
          if (open && disabledReason) details.cancel();
        }}
        onValueChange={(next, details) => {
          if (disabledReason || next === null) {
            details.cancel();
            return;
          }
          onValueChange?.(next);
        }}
      >
        <BaseSelect.Label className={hideLabel ? styles.hiddenLabel : styles.label}>{label}</BaseSelect.Label>
        <ReasonTooltip reason={disabledReason}>
          <BaseSelect.Trigger
            {...(description ? { "aria-describedby": descriptionId } : {})}
            className={cx(styles.trigger, triggerClassName)}
          >
            <BaseSelect.Value className={styles.value} {...(placeholder ? { placeholder } : {})} />
            <BaseSelect.Icon className={styles.chevron}>
              <Icon name="chevron-down" />
            </BaseSelect.Icon>
          </BaseSelect.Trigger>
        </ReasonTooltip>
        {description ? (
          <span id={descriptionId} className={styles.description}>
            {description}
          </span>
        ) : null}
        <BaseSelect.Portal>
          <BaseSelect.Positioner className={styles.positioner} alignItemWithTrigger={false} sideOffset={4}>
            <BaseSelect.Popup className={styles.popup} data-keyctx="list">
              <BaseSelect.List>
                {options.map((option) => (
                  <BaseSelect.Item key={option.value} value={option.value} label={option.label} className={styles.option}>
                    <span className={styles.check}>
                      <BaseSelect.ItemIndicator>
                        <Icon name="check" size="small" />
                      </BaseSelect.ItemIndicator>
                    </span>
                    <div className={styles.optionText}>
                      <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
                      {option.description ? <div className={styles.optionDescription}>{option.description}</div> : null}
                    </div>
                  </BaseSelect.Item>
                ))}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      </BaseSelect.Root>
    </div>
  );
}
