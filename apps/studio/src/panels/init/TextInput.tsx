import { NumberField } from "@/ui/fields/NumberField";
import { TextField } from "@/ui/fields/TextField";
import type { FieldControlProps } from "./field-props";
import { displayText, parseFieldText } from "./field-value";
import styles from "./InitEditor.module.css";
import { setArg, useDraft } from "./use-draft";

const SUFFIX: Partial<Record<string, string>> = { percent: "%", amount: "wei" };

/**
 * Text-like fields (spec L464-L465): strings (with the contract's length limit in the help), percents (0-100),
 * token amounts in raw wei (the token's units aren't known offline), whole numbers with ↑/↓ stepping, and bytes
 * or lists as typed. Commits on Enter or blur; Esc reverts.
 */
export function TextInput({ field, value, description, error, disabledReason }: FieldControlProps) {
  const draft = useDraft(displayText(value), async (text) => {
    const parsed = parseFieldText(field, text);
    return parsed.ok ? setArg(field.path, parsed.value) : parsed.error;
  });
  const shownError = draft.error ?? (draft.editing ? null : error);

  if (field.kind === "integer") {
    return (
      // Enter, Esc and blur come up from NumberField's input, which takes no handlers of its own; the wrapper isn't a control.
      // oxlint-disable-next-line jsx-a11y/no-static-element-interactions
      <div onKeyDown={draft.onKeyDown} onBlur={draft.onBlur}>
        <NumberField
          label={field.label}
          value={draft.text}
          onValueChange={draft.change}
          signed={field.type.startsWith("int")}
          {...(field.min === undefined ? {} : { min: field.min })}
          {...(field.max === undefined ? {} : { max: field.max })}
          description={description}
          error={shownError}
          disabledReason={disabledReason}
          required={field.required}
        />
      </div>
    );
  }

  const suffix = SUFFIX[field.kind];
  const limit = field.maxLength === undefined ? null : ` Up to ${field.maxLength} ${field.kind === "bytes" ? "bytes" : "characters"}.`;
  const unit = field.kind === "percent" ? ` Percent, ${field.min ?? "0"}-${field.max ?? "100"}.` : field.kind === "amount" ? " In wei." : null;
  return (
    <TextField
      label={field.label}
      value={draft.text}
      onValueChange={draft.change}
      onKeyDown={draft.onKeyDown}
      onBlur={draft.onBlur}
      mono={field.kind !== "string"}
      autoComplete="off"
      {...(field.kind === "percent" || field.kind === "amount" ? { inputMode: "decimal" as const } : {})}
      description={
        <>
          {description}
          {unit}
          {limit}
        </>
      }
      error={shownError}
      disabledReason={disabledReason}
      required={field.required}
      {...(suffix
        ? {
            trailing: (
              <span className={styles.suffix} aria-hidden="true">
                {suffix}
              </span>
            ),
          }
        : {})}
    />
  );
}
