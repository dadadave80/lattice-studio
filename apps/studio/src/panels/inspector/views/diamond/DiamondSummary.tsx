import type { InitPlan } from "@lattice-studio/core";
import { formatProblemSummary, planInit, plural } from "@lattice-studio/core";
import { useMemo } from "react";
import { commandRef, useAnalysis, useCatalog, useDocument } from "@/contracts";
import { CommandButton } from "@/ui";
import { SpecRow } from "../../shared/SpecRow";
import { SpecRows } from "../../shared/SpecRows";
import sheet from "../../shared/sheet.module.css";
import { initText, missingArgs, namespaceIds } from "./diamond-words";
import styles from "./diamond.module.css";
import { breakIdentifier } from "@/ui/text/Identifier";

/** The diamond at a glance (IR L119): hash, catalog, facets, problems, namespaces and init; the Core section above has the selectors. */
export function DiamondSummary() {
  const recipe = useDocument((s) => s.project.recipe);
  const catalog = useCatalog();
  const recipeHash = useAnalysis((a) => a.recipeHash);
  const stats = useAnalysis((a) => a.stats);
  const problems = useAnalysis((a) => a.problems);

  const counts = useMemo(() => {
    let blockers = 0;
    let warnings = 0;
    for (const problem of problems) {
      if (problem.severity === "blocker") blockers += 1;
      else if (problem.severity === "warning") warnings += 1;
    }
    return {
      blockers,
      warnings,
      initMissing: problems.some((problem) => problem.code === "INIT-01"),
      storageClash: problems.some((problem) => problem.code === "STO-01"),
    };
  }, [problems]);
  const namespaces = useMemo(() => namespaceIds(recipe, catalog), [recipe, catalog]);
  const init = useMemo<InitPlan | null>(() => (catalog ? planInit(recipe, catalog) : null), [recipe, catalog]);
  const missing = init && counts.initMissing ? missingArgs(init) : 0;

  return (
    <>
      <section className={sheet.section} aria-label="Summary">
        <SpecRows>
          <SpecRow label="Recipe hash">{recipeHash}</SpecRow>
          <SpecRow label="Catalog">{recipe.catalog.tag}</SpecRow>
          {/* Cards: the core's facets aside. Its Fallback row above carries the selector counts. */}
          <SpecRow label="Facets">{stats.facets}</SpecRow>
          <SpecRow label="Problems">{formatProblemSummary(counts)}</SpecRow>
          <SpecRow label="Namespaces">
            <span>{`${plural(namespaces.length, "namespace")} · ${counts.storageClash ? "overlapping" : "disjoint"}`}</span>
            {namespaces.length > 0 ? (
              <ul className={styles.plainList} aria-label="Namespaces">
                {namespaces.map((id) => (
                  <li key={id} className={styles.faint}>
                    {breakIdentifier(id)}
                  </li>
                ))}
              </ul>
            ) : null}
          </SpecRow>
          <SpecRow label="Init">
            {init ? initText(recipe, init) : "No init"}
            {missing > 0 ? ` · ${plural(missing, "required argument")} missing` : null}
          </SpecRow>
        </SpecRows>
      </section>
      <div className={styles.actionBar}>
        {counts.initMissing ? (
          <CommandButton command={commandRef("init.open")} variant="primary" size="small">
            Fill in
          </CommandButton>
        ) : null}
        <CommandButton command={commandRef("problem.next")} size="small">
          Next problem
        </CommandButton>
        <CommandButton command={commandRef("layout.tidy")} size="small">
          Tidy
        </CommandButton>
      </div>
    </>
  );
}
