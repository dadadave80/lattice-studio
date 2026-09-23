import type { KeyboardEvent, ReactNode } from "react";
import type { KeySpec } from "@/contracts";
import { stepDecimal, toStep, type DecimalBound } from "./decimal-step";
import styles from "./Field.module.css";
import { Select, type SelectOption } from "./Select";
import { TextField } from "./TextField";

export type NumberFieldProps<U extends string = string> = {
  /** The small-caps field label; the input's accessible name ("Initial supply"). */
  label: string;
  /** The amount as typed: a decimal string, never a JS number, so uint256 values keep every digit. */
  value: string;
  onValueChange: (text: string) => void;
  /** Units offered beside the amount (ether, gwei, wei). The select is named "{label} unit" ("Initial supply unit"). */
  units?: readonly SelectOption<U>[];
  unit?: U;
  onUnitChange?: (unit: U) => void;
  /** What ↑ and ↓ add or take away; Shift steps ten times as far. Default 1. */
  step?: bigint | number;
  /** Bounds for stepping, as decimal strings or bigints. Unsigned fields stop at 0. */
  min?: DecimalBound;
  max?: DecimalBound;
  /** Allows negative values (intN arguments). */
  signed?: boolean;
  description?: ReactNode;
  /** What's wrong with the value; sets `aria-invalid` (see `TextField`). */
  error?: string | null | undefined;
  /** Why it can't be edited now; applies to the unit select too (spec L661). */
  disabledReason?: string | null | undefined;
  readOnly?: boolean;
  required?: boolean;
  placeholder?: string;
  name?: string;
  className?: string | undefined;
};

const STEP_KEYS: readonly KeySpec[] = ["ArrowUp", "ArrowDown", "Shift+ArrowUp", "Shift+ArrowDown"];

/**
 * An amount typed as text (init arguments, settings), with ↑/↓ stepping by `step` and Shift+↑/↓ by ten
 * steps in exact decimal arithmetic. It is a text input, not a spinbutton: amounts can be larger than a
 * number can hold, and anything that isn't a plain decimal is left for the caller's validation.
 */
export function NumberField<U extends string = string>({
  label, value, onValueChange, units, unit, onUnitChange, step = 1, min, max, signed = false, description, error,
  disabledReason, readOnly = false, required = false, placeholder, name, className,
}: NumberFieldProps<U>) {
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const size = toStep(step);
    if (size === null) return;
    const delta = size * (event.shiftKey ? 10n : 1n) * (event.key === "ArrowUp" ? 1n : -1n);
    const next = stepDecimal(value, delta, { min, max, signed });
    if (next === null) return;
    event.preventDefault();
    if (disabledReason || readOnly || next === value) return;
    onValueChange(next);
  };

  const unitSelect = units?.length ? (
    <Select<U>
      label={`${label} unit`}
      hideLabel
      options={units}
      value={unit ?? null}
      onValueChange={(next) => onUnitChange?.(next)}
      disabledReason={disabledReason}
      className={styles.unitField}
      triggerClassName={styles.unit}
    />
  ) : null;

  return (
    <TextField
      label={label}
      value={value}
      onValueChange={onValueChange}
      onKeyDown={onKeyDown}
      inputMode="decimal"
      autoComplete="off"
      mono
      required={required}
      readOnly={readOnly}
      disabledReason={disabledReason}
      trailing={unitSelect}
      keyShortcuts={STEP_KEYS}
      {...(description ? { description } : {})}
      {...(error ? { error } : {})}
      {...(placeholder ? { placeholder } : {})}
      {...(name ? { name } : {})}
      {...(className ? { className } : {})}
    />
  );
}
