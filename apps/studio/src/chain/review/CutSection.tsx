import { plural, recipeStats, toChecksum } from "@lattice-studio/core";
import { useState } from "react";
import type { SectionStatus } from "./copy";
import { cutRows, problemStatus, worse, type CutRow } from "./model";
import { ProblemList } from "./ProblemList";
import { problemsIn, useReview } from "./review-data";
import styles from "./review.module.css";
import { Section } from "./Section";

/** "12 of 17 selectors" for a partial facet, "17 selectors" for a whole one. */
function selectorText(row: CutRow): string {
  const routed = row.selectors.length;
  return routed === row.exported ? plural(routed, "selector") : `${routed} of ${plural(row.exported, "selector")}`;
}

function checkText(row: CutRow, chainName: string): string {
  if (row.check === "matches") return "Matches";
  if (row.check === "differs") return "Differs from the catalog";
  if (row.check === "missing") return `Not on ${chainName} yet`;
  return "Not read yet";
}

/**
 * What gets cut (spec L566, L855): "14 facets · 120 selectors", expandable to each facet with its pinned version,
 * its release address in full, its selector count, the chain's codehash check and where the expected codehash comes
 * from (LatticeRegistry where it lists the version, else the catalog tag). A differing codehash blocks (NET-04).
 */
export function CutSection() {
  const review = useReview();
  const { analysis, catalog, chain, chainName, project, acked } = review;
  const problems = problemsIn(review, "cut");
  const rows = cutRows(analysis.plan, catalog, chain, project.deploy.path);
  const differs = rows.some((row) => row.check === "differs");
  // Opens by itself when a row blocks, until the person toggles it.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? differs;

  let status: SectionStatus = problemStatus(problems, acked);
  if (differs) status = worse(status, "blocked");
  if (rows.length === 0) status = worse(status, "waiting");

  return (
    <Section id="cut" status={status}>
      {rows.length === 0 ? (
        <p className={styles.muted}>Place facets to cut.</p>
      ) : (
        <details className={styles.disclosure} open={open} onToggle={(event) => setChosen(event.currentTarget.open)}>
          <summary>{recipeStats(analysis, catalog).text}</summary>
          <table className={styles.table} aria-label="Facets to cut">
            <thead>
              <tr>
                <th scope="col">Facet</th>
                <th scope="col">Address</th>
                <th scope="col">Selectors</th>
                <th scope="col">Codehash</th>
                <th scope="col">Expected codehash from</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.facet} data-facet={row.facet} data-check={row.check}>
                  <th scope="row">
                    {row.facet} {row.version}
                  </th>
                  <td className={styles.mono}>{toChecksum(row.address)}</td>
                  <td>{selectorText(row)}</td>
                  <td>{checkText(row, chainName)}</td>
                  <td>{row.source === "registry" ? "LatticeRegistry" : `catalog ${catalog.lattice.tag}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <ProblemList problems={problems} />
    </Section>
  );
}
