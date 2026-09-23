import { AddressInput } from "./AddressInput";
import { ChoiceInput } from "./ChoiceInput";
import { DurationInput } from "./DurationInput";
import type { FieldControlProps } from "./field-props";
import { TextInput } from "./TextInput";

/** The control for a field's kind (C4a's `FieldModel.kind`, spec L461-L465). */
export function FieldControl(props: FieldControlProps) {
  switch (props.field.kind) {
    case "address":
      return <AddressInput {...props} />;
    case "duration":
      return <DurationInput {...props} />;
    case "bool":
    case "enum":
      return <ChoiceInput {...props} />;
    default:
      return <TextInput {...props} />;
  }
}
