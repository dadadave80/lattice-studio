import { useId, type ReactNode } from "react";
import { Icon, type IconName } from "@/ui";
import { SECTION_TITLES, STATUS_WORDS, type SectionId, type SectionStatus } from "./copy";
import styles from "./review.module.css";

const ICONS: Record<SectionStatus, IconName> = { ok: "check", tick: "warning", blocked: "error", waiting: "info" };

export type SectionProps = {
  id: SectionId;
  status: SectionStatus;
  children: ReactNode;
};

/**
 * One of the review's nine sections (spec L562): its label, its status mark in words ("Ready", "Needs a tick",
 * "Blocks deploy", "Waiting") and what it proves. The mark describes the region, so a screen reader hears both.
 */
export function Section({ id, status, children }: SectionProps) {
  const headingId = useId();
  const markId = useId();
  return (
    <section
      className={styles.section}
      aria-labelledby={headingId}
      aria-describedby={markId}
      data-section={id}
      data-status={status}
    >
      <div className={styles.head}>
        <h3 id={headingId} className={styles.label}>
          {SECTION_TITLES[id]}
        </h3>
        <span id={markId} className={styles.mark} data-status={status}>
          <Icon name={ICONS[status]} size="small" />
          {STATUS_WORDS[status]}
        </span>
      </div>
      <div className={styles.content}>{children}</div>
    </section>
  );
}
