import { Icon, VisuallyHidden } from "@/ui";
import { codeRuns, SEVERITY_WORD, stepTitle, type StructureMeta } from "./structure-model";
import styles from "./StructurePanel.module.css";

/** A pin's state in a word, where the mark after the name doesn't already say it. */
const STATE_WORD: Partial<Record<string, string>> = {
  excluded: "not in the diamond",
  contested: "contested",
  default: "owner by default",
  unchecked: "not checked yet",
};

/**
 * One row's visible content. Rows are named by `aria-label` (the card's name for a facet, the pin's words
 * for a selector), so what shows here is for sight; a facet's connections are its description.
 */
export function StructureItem({ meta, descriptionId }: { meta: StructureMeta; descriptionId?: string | undefined }) {
  switch (meta.kind) {
    case "facet":
      return (
        <>
          <span className={styles.name}>{meta.facet}</span>
          {meta.count ? <span className={styles.aside}>{meta.count.replace(/ selectors?$/, "")}</span> : null}
          {meta.description && descriptionId ? <VisuallyHidden id={descriptionId}>{meta.description}</VisuallyHidden> : null}
        </>
      );
    case "selector": {
      const { view } = meta;
      const word = STATE_WORD[view.state];
      return (
        <>
          <span className={styles.code} data-state={view.state}>{view.name}</span>
          <span className={styles.mark} data-state={view.state}>
            {view.state === "seam" ? <Icon name="lock" size="small" /> : null}
            {view.mark}
          </span>
          {word ? <span className={styles.aside}>{word}</span> : null}
        </>
      );
    }
    case "problems":
      return (
        <>
          <span className={styles.name}>Problems</span>
          <span className={styles.aside}>{meta.count}</span>
        </>
      );
    case "problem":
      return (
        <span className={styles.problem}>
          <span className={styles.severity} data-severity={meta.problem.severity}>{SEVERITY_WORD[meta.problem.severity]}</span>
          <span className={styles.message}>
            {codeRuns(meta.problem.message).map((run, i) =>
              run.code ? <code key={i} className={styles.inline}>{run.text}</code> : <span key={i}>{run.text}</span>,
            )}
          </span>
        </span>
      );
    case "init":
      return (
        <>
          <span className={styles.name}>Init plan</span>
          <span className={styles.aside}>{meta.summary}</span>
        </>
      );
    case "step": {
      const { step } = meta;
      return (
        <>
          <span className={styles.index}>{step.index + 1}</span>
          <span className={styles.name}>{stepTitle(step)}</span>
          {step.locked ? <Icon name="lock" size="small" className={styles.lock} /> : null}
        </>
      );
    }
    case "sequence":
      return (
        <>
          <span className={styles.index}>{meta.position + 1}</span>
          <span className={styles.name}>{meta.module}</span>
        </>
      );
  }
}
