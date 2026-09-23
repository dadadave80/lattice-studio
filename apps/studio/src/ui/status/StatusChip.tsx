import { cx } from "../shared/cx";
import { VisuallyHidden } from "../shared/VisuallyHidden";
import styles from "./StatusChip.module.css";

/**
 * idle: Not deployed · pending: Proposed, verifying · live: Live · Sepolia · r1 ·
 * attention: Modified since r1, Mismatch · Sepolia.
 */
export type StatusTone = "idle" | "pending" | "live" | "attention";

export type StatusChipProps = {
  tone: StatusTone;
  /** The diamond state, as `formatStamp` writes it: "Live · Sepolia · r1". */
  text: string;
  /** Shrink to the dot and one word (320 px windows, spec L368). The full text stays readable to assistive technology. */
  compact?: boolean;
  className?: string;
};

/** A dot and words. The words carry the state; the dot's fill repeats it for a glance, never alone. */
export function StatusChip({ tone, text, compact = false, className }: StatusChipProps) {
  const word = text.split(/[\s·]+/)[0] ?? text;
  return (
    <span className={cx(styles.chip, styles[tone], className)} data-tone={tone} {...(compact ? { title: text } : {})}>
      <span className={styles.dot} aria-hidden="true" />
      {compact ? (
        <>
          <span aria-hidden="true">{word}</span>
          <VisuallyHidden>{text}</VisuallyHidden>
        </>
      ) : (
        <span className={styles.full}>{text}</span>
      )}
    </span>
  );
}
