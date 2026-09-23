import { Suspense, useMemo } from "react";
import { useAnalysis, useDocument, useSession } from "@/contracts";
import { CutPlanFooter } from "./plan/CutPlanFooter";
import { NarrowFillIn } from "./NarrowFillIn";
import { resolveView } from "./resolve-view";
import { ViewBoundary } from "./ViewBoundary";
import { ViewSwitch } from "./ViewSwitch";
import styles from "./InspectorPanel.module.css";

const joinIds = (ids: readonly string[]): string => ids.join("\n");

/**
 * The inspector (spec L358, IR L115-L126): the spec sheet for whatever is selected (Diamond, Facet, Selection),
 * or what a command routed here (Catalog preview, Problem, Comparison, and the seam's Init plan, problem docs
 * and Confirm addresses…), with the cut plan pinned at the foot. The region container is the shell's.
 */
export function InspectorPanel() {
  const view = useSession((s) => s.panes.inspector.view);
  const selection = useSession((s) => s.selection);
  const placed = useDocument((s) => s.project.recipe.facets);
  const problemIds = useAnalysis((a) => joinIds(a.problems.map((p) => p.id)));
  const resolved = useMemo(
    () => resolveView({ view, selection, placed, problems: problemIds === "" ? [] : problemIds.split("\n") }),
    [view, selection, placed, problemIds],
  );
  const key = JSON.stringify(resolved);

  return (
    <div className={styles.panel} data-inspector-view={resolved.kind}>
      <NarrowFillIn />
      <div className={styles.body}>
        <ViewBoundary key={key}>
          <Suspense fallback={<p className={styles.placeholder}>Loading…</p>}>
            <ViewSwitch view={resolved} />
          </Suspense>
        </ViewBoundary>
      </div>
      <CutPlanFooter />
    </div>
  );
}
