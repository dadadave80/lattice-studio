import { formatAddress, formatCount, isCoreFacet, plural, toChecksum, type Catalog } from "@lattice-studio/core";
import { useState } from "react";
import { copyText, IconButton } from "@/ui";
import type { SectionStatus } from "./copy";
import { cutRows, problemStatus, worse, type CutRow } from "./model";
import { ProblemList } from "./ProblemList";
import { problemsIn, useReview } from "./review-data";
import styles from "./review.module.css";
import { Section } from "./Section";

/** "12/17 selectors", routed of exported, as every count reads (spec L685). */
function selectorText(row: CutRow): string {
  return formatCount(row.selectors.length, row.exported);
}

function checkText(row: CutRow, chainName: string): string {
  if (row.check === "matches") return "Matches";
  if (row.check === "differs") return "Differs from the catalog";
  if (row.check === "missing") return `Not on ${chainName} yet`;
  return "Not read yet";
}

/** "The core and 12 facets · 120 selectors": the core's two Adds lead every cut, so they're named, not counted. */
function cutSize(plan: readonly { facet: string; selectors: readonly unknown[] }[]): string {
  const selectors = plan.reduce((sum, entry) => sum + entry.selectors.length, 0);
  return `The core and ${plural(plan.filter((entry) => !isCoreFacet(entry.facet)).length, "facet")} · ${plural(selectors, "selector")}`;
}

/** Names in a sentence: "A", "A and B", "A, B and C". */
function listed(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Where the expected codehashes come from (spec L566), said once under the table: LatticeRegistry where it lists
 * the version, else the catalog tag.
 */
function sourceLine(rows: readonly CutRow[], catalog: Catalog): string {
  const tag = `catalog ${catalog.lattice.tag}`;
  const registry = rows.filter((row) => row.source === "registry").map((row) => row.facet);
  const catalogOnly = rows.filter((row) => row.source === "catalog").map((row) => row.facet);
  if (catalogOnly.length === 0) return "Expected codehashes from LatticeRegistry.";
  if (registry.length === 0) return `Expected codehashes from ${tag}.`;
  // The shorter list is named; the other source covers the rest.
  if (catalogOnly.length <= registry.length) return `Expected codehashes from LatticeRegistry, and from ${tag} for ${listed(catalogOnly)}.`;
  return `Expected codehashes from ${tag}, and from LatticeRegistry for ${listed(registry)}.`;
}

/**
 * What gets cut (spec L566, L855): "The core and 12 facets · 120 selectors", expandable to each facet with its pinned version,
 * its release address (short, with Copy for the full one), its selector count and the chain's codehash check, then
 * where the expected codehashes come from in one line under the table. Opened, it spans the section. A differing
 * codehash blocks (NET-04).
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
          <summary>{cutSize(analysis.plan)}</summary>
          {/* Scrolls sideways on a phone; its Copy buttons keep it reachable by keyboard. */}
          <div className={styles.tableScroll}>
            <table className={`${styles.table} ${styles.cutTable}`} aria-label="Facets to cut">
              <thead>
                <tr>
                  <th scope="col">Facet</th>
                  <th scope="col">Address</th>
                  <th scope="col">Selectors</th>
                  <th scope="col">Codehash</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const address = toChecksum(row.address);
                  return (
                    <tr key={row.facet} data-facet={row.facet} data-check={row.check}>
                      <th scope="row">
                        {row.facet} {row.version}
                      </th>
                      <td>
                        <span className={styles.address}>
                          <span className={styles.mono} title={address} data-address={address}>
                            {formatAddress(address)}
                          </span>
                          <IconButton icon="copy" size="small" label="Copy address" onClick={() => void copyText(address)} />
                        </span>
                      </td>
                      <td className={styles.nowrap}>{selectorText(row)}</td>
                      <td className={styles.nowrap}>{checkText(row, chainName)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={styles.muted} data-codehash-source="">
            {sourceLine(rows, catalog)}
          </p>
        </details>
      )}
      <ProblemList problems={problems} />
    </Section>
  );
}
