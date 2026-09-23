import type { InspectorViewProps } from "@/contracts";
import { ViewHeader } from "../../shared/ViewHeader";
import styles from "../../shared/sheet.module.css";

export function SelectionView({ view }: InspectorViewProps<"selection">) {
  return (
    <div className={styles.view} data-view="selection">
      <ViewHeader title={"Selection"} kind="Selection" />
      <p className={styles.muted}>{JSON.stringify(view)}</p>
    </div>
  );
}
