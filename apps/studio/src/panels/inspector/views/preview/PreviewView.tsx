import type { InspectorViewProps } from "@/contracts";
import { ViewHeader } from "../../shared/ViewHeader";
import styles from "../../shared/sheet.module.css";

export function PreviewView({ view }: InspectorViewProps<"preview">) {
  return (
    <div className={styles.view} data-view="preview">
      <ViewHeader title={view.facet} kind="Catalog preview" />
      <p className={styles.muted}>{JSON.stringify(view)}</p>
    </div>
  );
}
