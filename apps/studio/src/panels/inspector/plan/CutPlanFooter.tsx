import { formatAddress } from "@lattice-studio/core";
import { useId, useMemo } from "react";
import { commandRef, useAnalysis, useCatalog } from "@/contracts";
import { CommandButton, VisuallyHidden } from "@/ui";
import { DiamondAddress } from "./DiamondAddress";
import { planRows } from "./plan-rows";
import styles from "./CutPlanFooter.module.css";

/**
 * The cut plan pinned at the inspector's foot (IR L126, board 06): `[00] ADD name`, address, routed/total
 * selectors and ⟂ while contested, with Copy plan as JSON; under it the diamond's address, predicted or live
 * (spec L384: Live badge, explorer and Louper links).
 */
export function CutPlanFooter() {
  const headingId = useId();
  const plan = useAnalysis((a) => a.plan);
  const routing = useAnalysis((a) => a.routing);
  const catalog = useCatalog();
  const rows = useMemo(() => planRows({ plan, routing }, catalog), [plan, routing, catalog]);

  return (
    <section className={styles.footer} aria-labelledby={headingId} data-inspector-plan="">
      <div className={styles.head}>
        <h2 id={headingId} className={styles.label}>
          DiamondCut plan
        </h2>
        <span className={styles.aside}>{rows.length} · cut order</span>
      </div>
      {rows.length === 0 ? (
        <p className={styles.empty}>No cuts yet. Place facets to plan the cut.</p>
      ) : (
        <ol className={styles.rows} aria-label="Cuts in order">
          {rows.map((row) => (
            <li key={row.facet} className={row.contested ? `${styles.row} ${styles.contested}` : styles.row}>
              <span className={styles.index}>{row.index}</span>
              <span className={styles.action}>ADD</span>
              <span className={styles.name}>{row.facet}</span>
              <span className={styles.address} title={row.address}>
                {formatAddress(row.address)}
              </span>
              <span className={styles.count}>{row.count}</span>
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
      <div className={styles.copy}>
        <CommandButton command={commandRef("plan.copyJson")} size="small" variant="quiet" />
      </div>
      <DiamondAddress />
    </section>
  );
}
