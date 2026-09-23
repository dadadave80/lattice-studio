import { Button } from "@/ui";
import { CONTROLLER_NOT_BUILT } from "./model";
import { useReview } from "./review-data";
import styles from "./review.module.css";

/** A failed deploy (Flow 12: Failed → Review, "fix and retry"): the spec's message for the failure, and Try again. */
export function FailedNotice({ error }: { error: string }) {
  const { controller } = useReview();
  return (
    <div className={styles.notice} role="alert">
      <span className={styles.content}>
        {error}
        <span className={styles.actions}>
          <Button size="small" disabledReason={controller ? null : CONTROLLER_NOT_BUILT} onClick={() => controller?.retry()}>
            Try again
          </Button>
        </span>
      </span>
    </div>
  );
}
