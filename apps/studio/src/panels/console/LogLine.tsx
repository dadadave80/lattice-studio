import type { KeyboardEvent } from "react";
import { VisuallyHidden } from "@/ui/shared/VisuallyHidden";
import { cx } from "@/ui/shared/cx";
import { InlineCode } from "./InlineCode";
import type { LogEntry } from "./log-store";
import styles from "./LogView.module.css";

export type LogLineProps = {
  entry: LogEntry;
  selected: boolean;
  /** The one line in Tab order (roving focus). */
  tabbable: boolean;
  /** The line names a facet or pin on the sheet: activating it locates that too. */
  locatable: boolean;
  onActivate: (entry: LogEntry) => void;
  onFocusLine: (entry: LogEntry) => void;
  /** ↑ ↓ Home End: moves focus among the lines. */
  onNavigate: (entry: LogEntry, event: KeyboardEvent<HTMLButtonElement>) => void;
};

/** Tags that name something needing a decision take the accent; the tag's word carries the meaning (spec L675). */
const ACCENT_TAGS = new Set(["Collision", "Missing", "Error"]);

/**
 * One console line: its tag, its text with code spans, and ×n when it repeated (IR L134). A button: activating
 * it selects the line (for Copy line) and selects and locates its facet or pin.
 */
export function LogLine({ entry, selected, tabbable, locatable, onActivate, onFocusLine, onNavigate }: LogLineProps) {
  return (
    <button
      type="button"
      className={cx(styles.line, entry.dim && styles.dim, selected && styles.selected, locatable && styles.locatable)}
      data-line-id={entry.id}
      data-tag={entry.tag}
      tabIndex={tabbable ? 0 : -1}
      aria-current={selected ? "true" : undefined}
      onClick={() => onActivate(entry)}
      onFocus={() => onFocusLine(entry)}
      onKeyDown={(event) => onNavigate(entry, event)}
    >
      <span className={cx(styles.tag, ACCENT_TAGS.has(entry.tag) && styles.accentTag)}>{entry.tag}</span>
      <span className={styles.text}>
        <InlineCode text={entry.text} />
        {entry.count > 1 ? (
          <span className={styles.count}>
            <span aria-hidden="true">×{entry.count}</span>
            <VisuallyHidden>{`, ${entry.count} times`}</VisuallyHidden>
          </span>
        ) : null}
      </span>
    </button>
  );
}
