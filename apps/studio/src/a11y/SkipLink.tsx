import type { MouseEvent } from "react";
import styles from "./a11y.module.css";
import { focusRegion, regionElement } from "./regions";

const FOCUSABLE = "[tabindex]:not([tabindex='-1']), button, a[href], input, select, textarea";

/** Moves focus into the sheet: its first Tab stop (the card grid, or the Start block), else the region. */
function skipToSheet(event: MouseEvent<HTMLAnchorElement>): void {
  // The hash belongs to S3's router (#/, #s=…), so the link never changes it.
  event.preventDefault();
  const sheet = regionElement("sheet");
  const first = sheet?.querySelector<HTMLElement>(FOCUSABLE);
  if (first) {
    first.focus();
    if (document.activeElement === first) return;
  }
  focusRegion("sheet");
}

/** "Skip to sheet" (spec L743): render it first in the app, so it's the first Tab stop. Hidden until focused. */
export function SkipLink() {
  return (
    <a href="#sheet" className={styles.skipLink} onClick={skipToSheet}>
      Skip to sheet
    </a>
  );
}
