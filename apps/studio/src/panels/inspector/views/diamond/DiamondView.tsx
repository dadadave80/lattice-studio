import type { InspectorViewProps } from "@/contracts";
import { ViewHeader } from "../../shared/ViewHeader";
import styles from "../../shared/sheet.module.css";

export function DiamondView({ view }: InspectorViewProps<"diamond">) {
  return (
    <div className={styles.view} data-view="diamond">
      <ViewHeader title={"Diamond"} kind="Assembly" />
      <p className={styles.muted}>{JSON.stringify(view)}</p>
    </div>
  );
}
