import type { RefObject } from "react";
import { plural } from "@lattice-studio/core";
import { catalogVersion } from "./copy";
import type { MigrationReview } from "./migrate-diff";
import { kindLabel, reviewSummary, selectorText, shortHex } from "./review-text";
import styles from "./flows.module.css";

export type MigrateReviewProps = {
  review: MigrationReview;
  /** The summary, focused when the review opens (IR L178). */
  summaryRef?: RefObject<HTMLParagraphElement | null>;
};

/** What Migrate changes, per contract the project uses (spec L290): selectors added or removed, and new code. */
export function MigrateReview({ review, summaryRef }: MigrateReviewProps) {
  const to = catalogVersion(review.toTag);
  return (
    <div className={styles.body}>
      <p ref={summaryRef} tabIndex={-1} className={styles.summary} data-migrate-summary="">
        {reviewSummary(review)}
      </p>
      {review.complete ? null : (
        <p className={styles.note}>{`Code changes can't be listed without catalog ${catalogVersion(review.fromTag)}.`}</p>
      )}
      {review.changes.length > 0 ? (
        <ul className={styles.changes} aria-label="Changes">
          {review.changes.map((change) => (
            <li key={`${change.kind}:${change.name}`} className={styles.change}>
              <h4 className={styles.changeName}>
                {change.name} <span className={styles.kind}>{kindLabel(change)}</span>
              </h4>
              <ul className={styles.lines}>
                {change.missing ? <li data-kind="remove">{`Not in ${to}: it leaves the sheet`}</li> : null}
                {change.added.map((s) => (
                  <li key={`+${s.hex}`} data-kind="add">{`Added ${selectorText(s)}`}</li>
                ))}
                {change.removed.map((s) => (
                  <li key={`-${s.hex}`} data-kind="remove">{`Removed ${selectorText(s)}`}</li>
                ))}
                {change.code ? (
                  <li data-kind="code">{`New code: ${shortHex(change.code.from)} → ${shortHex(change.code.to)}`}</li>
                ) : null}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}
      {review.dropped.exclude.length > 0 ? (
        <p className={styles.note}>{`${plural(review.dropped.exclude.length, "exclusion")} of selectors ${to} doesn't have will be dropped.`}</p>
      ) : null}
    </div>
  );
}
