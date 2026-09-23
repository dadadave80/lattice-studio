import { useId, useRef, type ReactNode } from "react";
import { useInspectorFocus, type FocusTarget } from "../focus-request";
import styles from "./sheet.module.css";

export type SectionProps = {
  /** The small-caps label: "Selectors", "Deployments". Names the section for assistive technology. */
  label: string;
  /** A quiet note on the right of the label: "16 · cut order". */
  aside?: ReactNode;
  /** A Diamond view section a command can land on (deployments.show). */
  focusTarget?: Extract<FocusTarget, { kind: "section" }>;
  children: ReactNode;
  className?: string;
};

/** One labelled block of the spec sheet. */
export function Section({ label, aside, focusTarget, children, className }: SectionProps) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useInspectorFocus(focusTarget ?? null, heading);
  return (
    <section
      aria-labelledby={id}
      className={className ? `${styles.section} ${className}` : styles.section}
      {...(focusTarget ? { "data-section": focusTarget.section } : {})}
    >
      <div className={styles.sectionHead}>
        <h3 id={id} ref={heading} className={styles.sectionLabel} {...(focusTarget ? { tabIndex: -1 } : {})}>
          {label}
        </h3>
        {aside === undefined ? null : <span className={styles.sectionAside}>{aside}</span>}
      </div>
      {children}
    </section>
  );
}
