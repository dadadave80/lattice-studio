import { Input } from "@base-ui/react/input";
import { useId, type FocusEvent, type HTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from "react";
import type { KeySpec } from "@/contracts";
import { Icon } from "../icons/Icon";
import { useAriaKeyShortcuts } from "../keys/use-aria-key-shortcuts";
import { cx } from "../shared/cx";
import { Tooltip } from "../tooltip/Tooltip";
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
  /** "password" masks a secret (an API key) on screen. Defaults to "text". */
  type?: "text" | "password";
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
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  /** Focus the input when it mounts (an inline rename that just opened). */
  autoFocus?: boolean;
  /**
   * Keys the field handles itself, set as `aria-keyshortcuts` per platform ("ArrowUp", "Shift+ArrowUp" on a
   * NumberField); single-key ones only while those are on.
   */
  keyShortcuts?: KeySpec | readonly KeySpec[];
  /** The input element, to focus or select it from outside. */
  inputRef?: Ref<HTMLInputElement>;
  /** The input's id; generated when left out. */
  id?: string;
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
  placeholder, type, inputMode, autoComplete, spellCheck, disabledReason, trailing, onKeyDown, onBlur, autoFocus = false,
  keyShortcuts, inputRef, id, name, className,
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const keyshortcuts = useAriaKeyShortcuts(keyShortcuts);
  const descriptionId = useId();
  const errorId = useId();
  const reasonId = useId();
  const describedBy = [description ? descriptionId : null, error ? errorId : null, disabledReason ? reasonId : null]
    .filter(Boolean)
    .join(" ");
  const input = (
    <Input
      id={inputId}
      {...(disabledReason ? { "aria-disabled": true } : {})}
      {...(inputRef ? { ref: inputRef } : {})}
      {...(value === undefined ? {} : { value })}
      {...(defaultValue === undefined ? {} : { defaultValue })}
      {...(describedBy ? { "aria-describedby": describedBy } : {})}
      {...(error ? { "aria-invalid": true } : {})}
      {...(placeholder ? { placeholder } : {})}
      {...(type ? { type } : {})}
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
      {...(onBlur ? { onBlur } : {})}
      {...(autoFocus ? { autoFocus } : {})}
      {...keyshortcuts}
      className={cx(styles.input, mono && styles.mono)}
    />
  );
  // The disabled-control pattern (spec L661) wired here rather than through ReasonTooltip, which puts the
  // reason inside its trigger: an input can't hold children. The input is already read-only and refuses edits.
  // The Tooltip always wraps the input (toggling `disabled` instead of mounting and unmounting it), so a reason
  // coming or going doesn't remount the input and take focus with it.
  const control = (
    <Tooltip content={disabledReason ?? ""} disabled={!disabledReason} closeOnClick={false}>
      {input}
    </Tooltip>
  );
  return (
    <div className={cx(styles.field, className)}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      {trailing ? (
        <div className={styles.inputRow}>
          {control}
          {trailing}
        </div>
      ) : (
        control
      )}
      {disabledReason ? (
        <span id={reasonId} hidden>
          {disabledReason}
        </span>
      ) : null}
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
