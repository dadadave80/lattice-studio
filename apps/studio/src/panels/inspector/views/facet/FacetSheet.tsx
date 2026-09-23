import type { Catalog, Facet } from "@lattice-studio/core";
import { planInit } from "@lattice-studio/core";
import { useMemo } from "react";
import { useAnalysis, useDocument } from "@/contracts";
import { anchoredProblems, initPlacement, selectorCounts } from "./facet-model";
import { FacetProblems } from "./FacetProblems";
import { FacetSpecRows } from "./FacetSpecRows";
import { FacetSummary } from "./FacetSummary";
import { InitSection } from "./InitSection";
import { ReleaseSection } from "./ReleaseSection";
import { RequiresSection } from "./RequiresSection";
import { SeamsSection } from "./SeamsSection";
import { SelectorList } from "./SelectorList";
import { StorageSection } from "./StorageSection";
import sheet from "../../shared/sheet.module.css";

export type FacetSheetProps = {
  facet: Facet;
  catalog: Catalog;
  /** Catalog preview: no pin actions, no Place buttons, no step moves; no problems or chain status row. */
  readOnly: boolean;
};

/** The facet's spec sheet (IR L118, board 06), shared by the Facet view and the Catalog preview. */
export function FacetSheet({ facet, catalog, readOnly }: FacetSheetProps) {
  const recipe = useDocument((s) => s.project.recipe);
  const routing = useAnalysis((a) => a.routing);
  const problems = useAnalysis((a) => a.problems);
  const counts = useMemo(() => selectorCounts(facet, routing, recipe.exclude), [facet, routing, recipe.exclude]);
  const placement = useMemo(() => initPlacement(facet, recipe, catalog, planInit(recipe, catalog)), [facet, recipe, catalog]);
  const anchored = useMemo(() => (readOnly ? [] : anchoredProblems(problems, [facet.name])), [problems, facet.name, readOnly]);

  return (
    <>
      <FacetSummary facet={facet} />
      <div className={sheet.section}>
        <FacetSpecRows facet={facet} counts={counts} placement={placement} />
      </div>
      <FacetProblems problems={anchored} />
      <SelectorList facet={facet} catalog={catalog} readOnly={readOnly} />
      <StorageSection facet={facet} catalog={catalog} />
      <RequiresSection facet={facet} readOnly={readOnly} />
      <SeamsSection facet={facet} catalog={catalog} />
      <InitSection spec={facet.init} placement={placement} catalog={catalog} readOnly={readOnly} />
      <ReleaseSection facet={facet} chainStatus={!readOnly} />
    </>
  );
}
