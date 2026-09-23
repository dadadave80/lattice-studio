import type { InspectorViewProps } from "@/contracts";
import { ViewHeader } from "../../shared/ViewHeader";
import styles from "../../shared/sheet.module.css";

export function FacetView({ view }: InspectorViewProps<"facet">) {
  return (
    <div className={styles.view} data-view="facet">
      <ViewHeader title={view.facet} kind="Facet" />
      <p className={styles.muted}>{JSON.stringify(view)}</p>
    </div>
  );
}
