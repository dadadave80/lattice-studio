import styles from "./InitEditor.module.css";

export type DotState = "example" | "set";

/**
 * The field's dot (spec L466): "Example" while it still holds the template's example value (INIT-05), "Set by
 * you" once it holds anything else. The word is always written: the dot alone never carries the meaning.
 */
export function ValueDot({ state, source }: { state: DotState; source?: string | undefined }) {
  return (
    <span className={styles.dot} data-state={state} {...(source ? { title: `From ${source}` } : {})}>
      {state === "example" ? "Example" : "Set by you"}
    </span>
  );
}
