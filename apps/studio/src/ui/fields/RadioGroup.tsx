import { Radio } from "@base-ui/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import { useId } from "react";
import { cx } from "../shared/cx";
import { ReasonTooltip } from "../tooltip/ReasonTooltip";
import styles from "./Choice.module.css";

export type RadioOption = {
  value: string;
  /** Sentence-case option text; it is the radio's accessible name. */
  label: string;
  /** Help under the option, set as its description. */
  description?: string;
  /**
   * Why this option can't be picked now ("Connect a wallet first"). The radio gets `aria-disabled`, is
   * described by the reason, shows it in a tooltip and is never selected (spec L661). Base UI's arrow keys
   * skip `aria-disabled` radios (APG), so the reason is also written under the option for everyone to read.
   */
  disabledReason?: string | null | undefined;
};

export type RadioGroupProps = {
  /** The group's small-caps legend and accessible name ("Deploy with"). */
  label: string;
  options: readonly RadioOption[];
  /** Controlled value. */
  value?: string;
  /** Uncontrolled initial value. */
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  className?: string | undefined;
};

/** One choice from a few visible options. Arrow keys move and select (APG radio group); Tab leaves the group. */
export function RadioGroup({ label, options, value, defaultValue, onValueChange, name, className }: RadioGroupProps) {
  const legendId = useId();
  return (
    <div className={cx(styles.group, className)}>
      <span id={legendId} className={styles.legend}>
        {label}
      </span>
      <BaseRadioGroup
        aria-labelledby={legendId}
        {...(value === undefined ? {} : { value })}
        {...(defaultValue === undefined ? {} : { defaultValue })}
        {...(name ? { name } : {})}
        onValueChange={(next, details) => {
          if (typeof next !== "string" || options.find((o) => o.value === next)?.disabledReason) {
            details.cancel();
            return;
          }
          onValueChange?.(next);
        }}
        className={styles.options}
      >
        {options.map((option) => (
          <RadioRow key={option.value} option={option} />
        ))}
      </BaseRadioGroup>
    </div>
  );
}

function RadioRow({ option }: { option: RadioOption }) {
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className={styles.choice}>
      <label className={styles.row}>
        <ReasonTooltip reason={option.disabledReason}>
          <Radio.Root
            value={option.value}
            aria-labelledby={labelId}
            {...(option.description ? { "aria-describedby": descriptionId } : {})}
            className={styles.radio}
          >
            <Radio.Indicator className={styles.dot} />
          </Radio.Root>
        </ReasonTooltip>
        <span id={labelId} className={styles.text}>
          {option.label}
        </span>
      </label>
      {option.description ? (
        <span id={descriptionId} className={styles.description}>
          {option.description}
        </span>
      ) : null}
      {option.disabledReason ? (
        <span className={styles.description} data-reason="">
          {option.disabledReason}
        </span>
      ) : null}
    </div>
  );
}
