import type { ReactNode } from "react";
import styles from "./sheet.module.css";

export type SpecRowProps = {
  /** Small caps in the 96 px column: "Source", "Selectors". */
  label: string;
  children: ReactNode;
};

/** One label and value of a spec sheet. Put rows inside `SpecRows` (a `<dl>`). */
export function SpecRow({ label, children }: SpecRowProps) {
  return (
    <div className={styles.row}>
      <dt className={styles.label}>{label}</dt>
      <dd className={styles.value}>{children}</dd>
    </div>
  );
}
