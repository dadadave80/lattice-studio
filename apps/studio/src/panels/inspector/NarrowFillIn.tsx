import { commandRef, useAnalysis } from "@/contracts";
import { CommandButton } from "@/ui";
import styles from "./InspectorPanel.module.css";

/**
 * Under 768 px, **Fill in** sits at the top of the Inspector pane while required arguments are empty
 * (spec L370, L365). Wider, the title block carries it, so this bar hides.
 */
export function NarrowFillIn() {
  const missing = useAnalysis((a) => a.problems.some((p) => p.code === "INIT-01"));
  if (!missing) return null;
  return (
    <div className={styles.narrowFillIn} data-narrow-fill-in="">
      <CommandButton command={commandRef("init.open")} variant="primary" size="small">
        Fill in
      </CommandButton>
    </div>
  );
}
