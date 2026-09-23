import { useState } from "react";
import { NumberField } from "@/ui/fields/NumberField";
import { bestUnit, DURATION_UNITS, durationEcho, fromSeconds, toSeconds, type DurationUnit } from "./duration";
import type { FieldControlProps } from "./field-props";
import { displayText } from "./field-value";
import styles from "./InitEditor.module.css";
import { setArg, useDraft } from "./use-draft";

const UNIT_OPTIONS = DURATION_UNITS.map((u) => ({ value: u.value, label: u.label }));

/**
 * A duration (spec L463): a number and a unit (seconds, minutes, hours, days), stored in seconds and echoed as
 * "= 5 minutes". The amount commits on Enter or blur; picking a unit commits the amount in that unit.
 */
export function DurationInput({ field, value, description, error, disabledReason }: FieldControlProps) {
  const stored = displayText(value);
  const [chosen, setChosen] = useState<DurationUnit | null>(null);
  const best = bestUnit(stored);
  const inChosen = chosen === null ? null : fromSeconds(stored, chosen);
  // Show the stored value in the unit picked, when it comes out exactly; else in the unit that reads best.
  const unit: DurationUnit = inChosen === null ? best.unit : (chosen ?? best.unit);
  const amount = inChosen ?? best.amount;

  const draft = useDraft(amount, (text) => setArg(field.path, toSeconds(text, unit) ?? text.trim()));
  const seconds = draft.editing ? toSeconds(draft.text, unit) : /^\d+$/.test(stored) ? stored : null;
  const echo = durationEcho(seconds, unit);

  const pickUnit = (next: DurationUnit) => {
    setChosen(next);
    const typed = draft.text;
    draft.revert();
    const converted = toSeconds(typed, next);
    if (typed.trim() !== "" && converted !== stored) void setArg(field.path, converted ?? typed.trim());
  };

  return (
    // Enter, Esc and blur come up from NumberField's input and unit select; the wrapper isn't a control.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
    <div onKeyDown={draft.onKeyDown} onBlur={draft.onBlur}>
      <NumberField<DurationUnit>
        label={field.label}
        value={draft.text}
        onValueChange={draft.change}
        units={UNIT_OPTIONS}
        unit={unit}
        onUnitChange={pickUnit}
        description={
          <>
            {description}
            {echo ? (
              <>
                {" "}
                <span className={styles.status} aria-live="polite">
                  {echo}
                </span>
              </>
            ) : null}
          </>
        }
        error={draft.error ?? (draft.editing ? null : error)}
        disabledReason={disabledReason}
        required={field.required}
      />
    </div>
  );
}
