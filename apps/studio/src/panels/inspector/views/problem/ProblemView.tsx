import type { InspectorViewProps } from "@/contracts";
import { ViewHeader } from "../../shared/ViewHeader";
import styles from "../../shared/sheet.module.css";

export function ProblemView({ view }: InspectorViewProps<"problem">) {
  return (
    <div className={styles.view} data-view="problem">
      <ViewHeader title={"Problem"} kind="Problem" />
      <p className={styles.muted}>{JSON.stringify(view)}</p>
    </div>
  );
}
