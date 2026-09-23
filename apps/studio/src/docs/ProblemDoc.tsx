/**
 * One problem code's doc page (spec L905): what it means, why, how to fix, and an example. Opened in
 * place by the inspector's "doc" view (`DocView.tsx`); also usable on its own (the docs' own tests render
 * it directly). The example is never a copy of the checks table's wording: it calls C10's `renderProblem`
 * with the code's own representative params, so it stays correct wherever the message template changes.
 */
import { PROBLEMS, renderProblem, type ProblemCode, type Severity } from "@lattice-studio/core";
import { useEffect, useRef } from "react";
import { useCatalog } from "@/contracts";
import { PROBLEM_DOC_CONTENT } from "./content";
import { renderList, renderParagraphs } from "./markdown";
import styles from "./ProblemDoc.module.css";

const SEVERITY_LABEL: Record<Severity, string> = { blocker: "Blocker", warning: "Warning", info: "Info" };

export type ProblemDocProps = {
  code: ProblemCode;
  /** Shown as a "Show all problem docs" control above the page; omitted when there's nowhere to go back to. */
  onBack?: () => void;
};

/** A "variable"-severity code's own range (checks table, spec L328): INIT-03 is the only one with an info case. */
const VARIABLE_SEVERITY_LABEL: Partial<Record<ProblemCode, string>> = {
  "INIT-03": "Blocker, warning or info",
  "NET-06": "Blocker or warning",
};

/** One code's severity, as the checks table gives it. */
function severityLabel(code: ProblemCode): string {
  const info = PROBLEMS[code];
  if (info.severity === "variable") return VARIABLE_SEVERITY_LABEL[code] ?? "Varies by case";
  return SEVERITY_LABEL[info.severity];
}

export function ProblemDoc({ code, onBack }: ProblemDocProps) {
  const catalog = useCatalog();
  const entry = PROBLEM_DOC_CONTENT[code];
  const info = PROBLEMS[code];
  const commit = catalog?.lattice.commit ?? null;
  const example = renderProblem(code, entry.exampleParams as never);
  const titleId = `doc-${code}-title`;
  const headingRef = useRef<HTMLHeadingElement>(null);

  // In-place navigation (opened from HelpIndex, or from another code): focus moves to this page's own
  // heading, never left on the control that opened it or dropped to <body> (spec L751-L761, WCAG 2.4.3).
  useEffect(() => {
    headingRef.current?.focus();
  }, [code]);

  return (
    <article className={styles.doc} aria-labelledby={titleId}>
      {onBack ? (
        <button type="button" className={styles.back} onClick={onBack}>
          Show all problem docs
        </button>
      ) : null}
      <p className={styles.eyebrow}>
        {code} · {severityLabel(code)}
        {info.ack ? " · acknowledge to deploy" : ""}
      </p>
      <h2 id={titleId} ref={headingRef} tabIndex={-1} className={styles.title}>
        {entry.title}
      </h2>

      <section aria-label="What it means" className={styles.section}>
        <h3 className={styles.heading}>What it means</h3>
        {renderParagraphs(entry.meaning, commit, `${code}-meaning`)}
      </section>

      <section aria-label="Why" className={styles.section}>
        <h3 className={styles.heading}>Why</h3>
        {renderParagraphs(entry.why, commit, `${code}-why`)}
      </section>

      {entry.fixes.length > 0 ? (
        <section aria-label="How to fix" className={styles.section}>
          <h3 className={styles.heading}>How to fix</h3>
          {renderList(entry.fixes, commit, `${code}-fixes`)}
        </section>
      ) : null}

      <section aria-label="Example" className={styles.section}>
        <h3 className={styles.heading}>Example</h3>
        {entry.exampleNote ? renderParagraphs(entry.exampleNote, commit, `${code}-example-note`) : null}
        <div className={styles.example}>{renderParagraphs(example, commit, `${code}-example`)}</div>
      </section>
    </article>
  );
}
