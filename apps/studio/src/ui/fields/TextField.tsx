import { Input } from "@base-ui/react/input";
import { useId, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "../icons/Icon";
import { cx } from "../shared/cx";
import { ReasonTooltip } from "../tooltip/ReasonTooltip";
import styles from "./Field.module.css";

export type TextFieldProps = {
  /** The small-caps field label; the input's accessible name ("Salt"). */
  label: string;
  /** Controlled value. */
  value?: string;
  /** Uncontrolled initial value. */
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Help under the field, set as the input's description. */
  description?: ReactNode;
  /**
   * What's wrong with the value, and what to do: "Enter a 32-byte hex salt". Sets `aria-invalid` and shows
   * under the field with the error icon; the input is described by it.
   */
  error?: string | null | undefined;
  /** Machine-produced values (addresses, hashes, amounts) in JetBrains Mono, with spellcheck off. */
  mono?: boolean;
  required?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  inputMode?: HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  /** Defaults to off for `mono` fields, on otherwise. */
  spellCheck?: boolean;
  /**
   * Why the field can't be edited now ("Connect a wallet first"). While set the input stays focusable and
   * readable with `aria-disabled`, is described by the reason, shows it in a tooltip and never changes
   * (spec L661).
   */
  disabledReason?: string | null | undefined;
  /** Beside the input, inside the field: a unit select, a Copy button. */
  trailing?: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** `aria-keyshortcuts` for keys the field handles itself ("ArrowUp ArrowDown" on a NumberField). */
  keyShortcuts?: string;
  name?: string;
  className?: string | undefined;
};

/**
 * A labelled one-line text input with optional help and error. The label, description and error are wired by
 * id rather than through Base UI's Field, whose context would also claim a `trailing` Select. Long values scroll inside the input; help and
 * error text wrap, and nothing has a fixed height (spec L787).
 */
export function TextField({
  label, value, defaultValue, onValueChange, description, error, mono = false, required = false, readOnly = false,
  placeholder, inputMode, autoComplete, spellCheck, disabledReason, trailing, onKeyDown, keyShortcuts, name, className,
}: TextFieldProps) {
  const inputId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const describedBy = [description ? descriptionId : null, error ? errorId : null].filter(Boolean).join(" ");
  const input = (
    <Input
      id={inputId}
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
      {...(error ? { "aria-invalid": true } : {})}
      {...(placeholder ? { placeholder } : {})}
      {...(inputMode ? { inputMode } : {})}
      {...(autoComplete ? { autoComplete } : {})}
      {...(name ? { name } : {})}
      {...(mono ? { autoCapitalize: "off", autoCorrect: "off" } : {})}
      spellCheck={spellCheck ?? !mono}
      required={required}
      readOnly={readOnly || Boolean(disabledReason)}
      onValueChange={(next, details) => {
        if (disabledReason) {
          details.cancel();
          return;
        }
        onValueChange?.(next);
      }}
      {...(onKeyDown ? { onKeyDown } : {})}
      {...(keyShortcuts ? { "aria-keyshortcuts": keyShortcuts } : {})}
      className={cx(styles.input, mono && styles.mono)}
    />
  );
  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      {trailing ? (
        <div className={styles.inputRow}>
          <ReasonTooltip reason={disabledReason}>{input}</ReasonTooltip>
          {trailing}
        </div>
      ) : (
        <ReasonTooltip reason={disabledReason}>{input}</ReasonTooltip>
      )}
      {description ? (
        <span id={descriptionId} className={styles.description}>
          {description}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className={styles.error}>
          <Icon name="error" className={styles.errorIcon} />
          <span>{error}</span>
        </span>
      ) : null}
    </div>
  );
}
