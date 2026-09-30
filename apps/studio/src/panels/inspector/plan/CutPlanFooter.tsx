import { formatAddress } from "@lattice-studio/core";
import { useId, useMemo } from "react";
import { commandRef, useAnalysis, useCatalog, useDocument } from "@/contracts";
import { CommandButton, VisuallyHidden } from "@/ui";
import { CORE_FIRST } from "../../core-copy";
import { DiamondAddress } from "./DiamondAddress";
import { omittedFacets, planRows } from "./plan-rows";
import styles from "./CutPlanFooter.module.css";

/**
 * The cut plan pinned at the inspector's foot (IR L126, board 06): `[00] ADD name`, address, routed/total
 * selectors and ⟂ while contested, with Copy plan as JSON; under it the diamond's address, predicted or live
 * (spec L384: Live badge, explorer and Louper links). The core's entries lead, tagged fixed: they're cut first
 * and stay. Facets that route nothing show below the rows too (PA L9, §18 #3c), the way the plan JSON and every
 * export already say what was left out.
 */
export function CutPlanFooter() {
  const headingId = useId();
  const plan = useAnalysis((a) => a.plan);
  const routing = useAnalysis((a) => a.routing);
  const placed = useDocument((s) => s.project.recipe.facets);
  const catalog = useCatalog();
  const rows = useMemo(() => planRows({ plan, routing }, catalog), [plan, routing, catalog]);
  const omitted = useMemo(() => omittedFacets(plan, placed), [plan, placed]);

  return (
    <section className={styles.footer} aria-labelledby={headingId} data-inspector-plan="">
      <div className={styles.head}>
        <h2 id={headingId} className={styles.label}>
          DiamondCut plan
        </h2>
        <span className={styles.aside}>{`${rows.length} · ${CORE_FIRST}`}</span>
      </div>
      {rows.length === 0 ? (
        <p className={styles.empty}>{catalog ? "No cuts yet. Place facets to plan the cut." : "Loading the catalog…"}</p>
      ) : (
        <ol className={styles.rows} aria-label="Cuts in order">
          {rows.map((row) => (
            <li
              key={row.facet}
              className={row.contested ? `${styles.row} ${styles.contested}` : styles.row}
              {...(row.fixed ? { "data-fixed": "" } : {})}
            >
              <span className={styles.index}>{row.index}</span>
              <span className={styles.action}>ADD</span>
              <span className={styles.name}>{row.facet}</span>
              <span className={styles.address} title={row.address}>
                {formatAddress(row.address)}
              </span>
              <span className={styles.count}>{row.count}</span>
              {/* After the count, so the core's names keep the first line's full width in a narrow inspector. */}
              {row.fixed ? <span className={styles.tag}>fixed</span> : null}
              {row.contested ? (
                <span className={styles.mark}>
                  <span aria-hidden="true">⟂</span>
                  <VisuallyHidden>contested</VisuallyHidden>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {omitted.length > 0 ? (
        <p className={styles.omitted} data-omitted="">
          {`Placed but routes nothing, so no Add is cut for it: ${omitted.join(", ")}.`}
        </p>
      ) : null}
      <div className={styles.copy}>
        <CommandButton command={commandRef("plan.copyJson")} size="small" variant="quiet" />
      </div>
      <DiamondAddress />
    </section>
  );
}
