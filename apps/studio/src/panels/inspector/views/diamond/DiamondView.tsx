import type { InspectorViewProps } from "@/contracts";
import { useDocument } from "@/contracts";
import { ViewHeader } from "../../shared/ViewHeader";
import styles from "../../shared/sheet.module.css";
import { AuthoritySection } from "./AuthoritySection";
import { ChainReadiness } from "./ChainReadiness";
import { DeploymentsList } from "./DeploymentsList";
import { DiamondSummary } from "./DiamondSummary";
import { StartingPoints } from "./StartingPoints";
import { UnknownFields } from "./UnknownFields";

/**
 * The inspector with nothing selected: the diamond itself (IR L119). An empty sheet shows the starting points
 * (spec L384); the view ends with the Deployments list. `view.section` needs nothing here: the frame's focus
 * request lands on the matching Section heading.
 */
export function DiamondView(_props: InspectorViewProps<"diamond">) {
  const name = useDocument((s) => s.project.name);
  const empty = useDocument((s) => s.project.recipe.facets.length === 0);
  return (
    <div className={styles.view} data-view="diamond">
      <ViewHeader title={name} kind="Assembly" />
      {empty ? (
        <StartingPoints />
      ) : (
        <>
          <DiamondSummary />
          <AuthoritySection />
        </>
      )}
      <UnknownFields />
      <ChainReadiness />
      <DeploymentsList />
    </div>
  );
}
