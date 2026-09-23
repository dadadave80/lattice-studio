import type { HTMLAttributes } from "react";
import { cx } from "./cx";
import styles from "./VisuallyHidden.module.css";

/** Text read by screen readers but not shown: a reason behind `aria-describedby`, a severity word. */
export function VisuallyHidden({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...rest} className={cx(styles.hidden, className)} />;
}
