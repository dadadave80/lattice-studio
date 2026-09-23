import type { InspectorViewProps } from "@/contracts";
import { ViewHeader } from "../../shared/ViewHeader";
import styles from "../../shared/sheet.module.css";

export function ComparisonView({ view }: InspectorViewProps<"comparison">) {
  return (
    <div className={styles.view} data-view="comparison">
      <ViewHeader title={"Comparison"} kind="Comparison" />
      <p className={styles.muted}>{JSON.stringify(view)}</p>
    </div>
  );
}
