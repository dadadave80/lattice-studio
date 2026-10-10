import type { ReactNode } from "react";
import { cx } from "@/ui/shared/cx";
import { breakIdentifier, identifierClass } from "@/ui/text/Identifier";
import styles from "./sheet.module.css";

export type SpecRowProps = {
  /** Small caps in the label column: "Source", "Selectors". */
  label: string;
  children: ReactNode;
};

/**
 * One label and value of a spec sheet. Put rows inside `SpecRows` (a `<dl>`). A text value wraps between its
 * tokens (`lattice.storage.` / `GovernedVault`); a hex value breaks anywhere.
 */
export function SpecRow({ label, children }: SpecRowProps) {
  const text = typeof children === "string" ? children : null;
  return (
    <div className={styles.row}>
      <dt className={styles.label}>{label}</dt>
      <dd className={cx(styles.value, text !== null && identifierClass(text))}>{text !== null ? breakIdentifier(text) : children}</dd>
    </div>
  );
}
