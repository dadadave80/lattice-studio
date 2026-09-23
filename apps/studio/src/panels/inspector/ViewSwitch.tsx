import { createElement } from "react";
import { inspectorViewComponent, type InspectorViewProps } from "@/contracts";
import { ComparisonView, DiamondView, FacetView, PreviewView, ProblemView, SelectionView } from "./lazy-views";
import { isOwnKind, SEAM_OWNERS, type ResolvedView } from "./resolve-view";
import styles from "./InspectorPanel.module.css";

/**
 * Renders the resolved view: S5c's own, or the component another module registered on the inspector seam
 * (contracts/inspector.ts), or `Not built yet · WP-<owner>` while none is registered. The frame wraps it in
 * `<Suspense>`: every view here is lazy.
 */
export function ViewSwitch({ view }: { view: ResolvedView }) {
  if (isOwnKind(view.kind)) {
    switch (view.kind) {
      case "diamond":
        return <DiamondView view={view as InspectorViewProps<"diamond">["view"]} />;
      case "facet":
        return <FacetView view={view as InspectorViewProps<"facet">["view"]} />;
      case "selection":
        return <SelectionView view={view as InspectorViewProps<"selection">["view"]} />;
      case "preview":
        return <PreviewView view={view as InspectorViewProps<"preview">["view"]} />;
      case "problem":
        return <ProblemView view={view as InspectorViewProps<"problem">["view"]} />;
      case "comparison":
        return <ComparisonView view={view as InspectorViewProps<"comparison">["view"]} />;
    }
  }
  const registered = inspectorViewComponent(view.kind);
  if (!registered) {
    const owner = SEAM_OWNERS[view.kind as keyof typeof SEAM_OWNERS];
    return (
      <p className={styles.placeholder}>
        {`Not built yet · WP-${owner}`}
      </p>
    );
  }
  return createElement(registered, { view: view as never });
}
