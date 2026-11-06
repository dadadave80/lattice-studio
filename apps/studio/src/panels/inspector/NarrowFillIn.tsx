import { commandRef, useAnalysis, useCatalog, useDocument, useSession } from "@/contracts";
import { planFields, planOf } from "@/panels/init/navigation";
import { CommandButton } from "@/ui";
import styles from "./InspectorPanel.module.css";

/**
 * Under 768 px, setup stays at the top of the Inspector unless its editor is already open.
 * Wider, the title block carries it, so this bar hides.
 */
export function NarrowFillIn() {
  const missing = useAnalysis((a) => a.problems.some((p) => p.code === "INIT-01"));
  const recipe = useDocument((s) => s.project.recipe);
  const catalog = useCatalog();
  const editing = useSession((s) => s.panes.inspector.view?.kind === "init");
  const hasSetup = catalog !== null && planFields(planOf(recipe, catalog)).length > 0;
  if (editing || (!missing && !hasSetup)) return null;
  return (
    <div className={styles.narrowFillIn} data-narrow-fill-in="">
      <CommandButton command={commandRef("init.open")} variant="primary" size="small">
        {missing ? "Fill in" : "Edit setup"}
      </CommandButton>
    </div>
  );
}
