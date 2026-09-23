import { Icon } from "@/ui/icons/Icon";
import { Select } from "@/ui/fields/Select";
import { Switch } from "@/ui/fields/Switch";
import type { FieldControlProps } from "./field-props";
import styles from "./InitEditor.module.css";
import { setArg } from "./use-draft";

/**
 * Booleans and enums (spec L465): a switch or a list of the values the rule allows. A pick is a commit, so there
 * is nothing to revert. An error joins the description, so the control is described by it (as TextField does).
 */
export function ChoiceInput({ field, value, description: help, error, disabledReason }: FieldControlProps) {
  const description = error ? (
    <>
      {help}
      <span className={styles.problemText}>
        <Icon name="error" label="Error" />
        <span>{error}</span>
      </span>
    </>
  ) : (
    help
  );
  return field.kind === "bool" ? (
    <Switch
      label={field.label}
      checked={value === true}
      onCheckedChange={(checked) => void setArg(field.path, checked)}
      description={description}
      disabledReason={disabledReason}
    />
  ) : (
    <Select
      label={field.label}
      options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
      value={typeof value === "string" && value !== "" ? value : null}
      onValueChange={(next) => void setArg(field.path, next)}
      placeholder={`Choose ${field.label.toLowerCase()}`}
      description={description}
      disabledReason={disabledReason}
    />
  );
}
