import { useId } from "react";
import styles from "./InitEditor.module.css";

/** A bundle's internal order, from the overlay, read-only: Solidity fixes it (spec L460, L467). */
export function BundleOrder({ spec, sequence }: { spec: string; sequence: readonly string[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.eyebrow}>
        {`Order inside ${spec}`}
      </h3>
      <p className={styles.empty}>Fixed in Solidity, so it can't be reordered.</p>
      <ol className={styles.sequence}>
        {sequence.map((module, i) => (
          <li key={module} className={styles.sequenceItem}>
            <span className={styles.sequenceIndex}>{i < 9 ? `0${i + 1}` : i + 1}</span>
            <span>{module}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
