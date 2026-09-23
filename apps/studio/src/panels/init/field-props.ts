import type { Arg, FieldModel } from "@lattice-studio/core";
import type { ReactNode } from "react";

/** What every init field control receives from its row. */
export type FieldControlProps = {
  field: FieldModel;
  /** The stored argument, if any. */
  value: Arg | undefined;
  /** The dot and the help text (spec L466), set as the control's description. */
  description: ReactNode;
  /** The analysis' messages for this path (INIT-01, AUTH-02), shown inline. */
  error: string | null;
  /** The session's read-only reason: the control stays readable and focusable, and never changes (spec L389). */
  disabledReason: string | null;
  projectId: string;
};
