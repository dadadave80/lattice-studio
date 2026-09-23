import type { ReactElement } from "react";
import { cx } from "../shared/cx";
import { VisuallyHidden } from "../shared/VisuallyHidden";
import { Tooltip } from "../tooltip/Tooltip";
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
  /**
   * Shrink to the dot and a short form (320 px windows, spec L368). The full text stays readable to
   * assistive technology and shows in a tooltip.
   */
  compact?: boolean;
  /** The compact form. Default: the stamp's first word ("Live", "Modified"), and "Not deployed" whole. */
  short?: string;
  /** Makes the chip a button (the title bar's chip opens the deployments list, IR L68). */
  onClick?: () => void;
  className?: string;
};

/** The compact form of a stamp: one word, except where one word would change the meaning. */
export function shortStamp(text: string): string {
  if (text.startsWith("Not deployed")) return "Not deployed";
  return text.split(/[\s·]+/)[0] ?? text;
}

/** A dot and words. The words carry the state; the dot's fill repeats it for a glance, never alone. */
export function StatusChip({ tone, text, compact = false, short, onClick, className }: StatusChipProps) {
  const body = (
    <>
      <span className={styles.dot} aria-hidden="true" />
      {compact ? (
        <>
          <span aria-hidden="true">{short ?? shortStamp(text)}</span>
          <VisuallyHidden>{text}</VisuallyHidden>
        </>
      ) : (
        <span className={styles.full}>{text}</span>
      )}
    </>
  );
  const classes = cx(styles.chip, styles[tone], onClick && styles.button, className);
  const chip: ReactElement = onClick ? (
    <button type="button" className={classes} data-tone={tone} onClick={onClick}>
      {body}
    </button>
  ) : (
    <span className={classes} data-tone={tone}>
      {body}
    </span>
  );
  return compact ? (
    <Tooltip content={text} closeOnClick={false}>
      {chip}
    </Tooltip>
  ) : (
    chip
  );
}
