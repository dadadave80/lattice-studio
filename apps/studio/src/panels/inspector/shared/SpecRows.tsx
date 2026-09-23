import type { ReactNode } from "react";
import styles from "./sheet.module.css";

/** The ruled label/value grid of a spec sheet: a `<dl>` of `SpecRow`s. */
export function SpecRows({ children }: { children: ReactNode }) {
  return <dl className={styles.rows}>{children}</dl>;
}
