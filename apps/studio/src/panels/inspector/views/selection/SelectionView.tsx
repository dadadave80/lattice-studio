import { useCompositionCatalog } from "@/chain/inspect/upgrade/use-composition-catalog";
import { facetDisplayName } from "@/chain/inspect/upgrade/catalog";
import { plural, recipeStats } from "@lattice-studio/core";
import { useMemo } from "react";
import type { InspectorViewProps } from "@/contracts";
import { commandRef, emptyAnalysis, useAnalysis, useDocument, useSession } from "@/contracts";
import { CommandButton, cx } from "@/ui";
import { Section } from "../../shared/Section";
import { ViewHeader } from "../../shared/ViewHeader";
import sheet from "../../shared/sheet.module.css";
import { CodeText } from "../facet/CodeText";
import { anchoredProblems } from "../facet/facet-model";

/**
 * The Selection view (IR L121): one row per selected facet with routed/total selectors and Open {name}, the
 * problems anchored to any of them (each once), and Remove {n}, Tidy selection and Move to….
 */
export function SelectionView(_props: InspectorViewProps<"selection">) {
  const selection = useSession((s) => s.selection);
  const placed = useDocument((s) => s.project.recipe.facets);
  const recipe = useDocument((s) => s.project.recipe);
  const plan = useAnalysis((a) => a.plan);
  const routing = useAnalysis((a) => a.routing);
  const allProblems = useAnalysis((a) => a.problems);
  const catalog = useCompositionCatalog();
  const selected = useMemo(() => selection.filter((name) => placed.includes(name)), [selection, placed]);
  // recipeStats reads only the plan and the routing.
  const perFacet = useMemo(
    () => (catalog ? recipeStats({ ...emptyAnalysis(), plan, routing }, catalog).perFacet : {}),
    [plan, routing, catalog],
  );
  const problems = useMemo(() => anchoredProblems(allProblems, selected), [allProblems, selected]);

  return (
    <div className={sheet.view} data-view="selection">
      <ViewHeader title={`${plural(selected.length, "facet")} selected`} kind="Selection" />
      <Section label="Facets" aside={`${selected.length}`}>
        <ul className={sheet.list}>
          {selected.map((name) => {
            const label = facetDisplayName(recipe, name);
            const instance = recipe.mode === "upgrade" ? recipe.facetInstances?.[name] : undefined;
            return (
            <li key={name} className={sheet.item} data-facet={name}>
              <div className={sheet.itemLine}>
                <span className={cx(sheet.mono, sheet.strong)}>{label}</span>
                <span className={sheet.muted}>{perFacet[name]?.text ?? ""}</span>
              </div>
              {instance ? <span className={sheet.mono} style={{ overflowWrap: "anywhere" }}>{instance.address}</span> : null}
              <div className={sheet.actions}>
                <CommandButton command={commandRef("inspector.show", { facet: name })} size="small" variant="quiet">
                  {`Open ${label}`}
                </CommandButton>
              </div>
            </li>
          ); })}
        </ul>
      </Section>
      {problems.length === 0 ? null : (
        <Section label="Problems" aside={`${problems.length}`}>
          <ul className={sheet.list}>
            {problems.map((problem) => (
              <li key={problem.id} className={sheet.item} data-problem={problem.id}>
                <p className={sheet.text}>
                  <CodeText text={problem.message} />
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section label="Actions">
        <div className={sheet.actions}>
          <CommandButton command={commandRef("facet.remove", { facets: [...selected] })} size="small" />
          <CommandButton command={commandRef("layout.tidySelection")} size="small" />
          <CommandButton command={commandRef("sheet.moveTo")} size="small">
            Move to…
          </CommandButton>
        </div>
      </Section>
    </div>
  );
}
