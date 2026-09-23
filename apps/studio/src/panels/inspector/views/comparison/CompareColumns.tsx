import type { Hex4, LoupeFacet, PlanComparison, PlanEntry } from "@lattice-studio/core";
import { formatAddress, plural } from "@lattice-studio/core";
import { useId } from "react";
import sheet from "../../shared/sheet.module.css";
import { denseSelector, type SignatureOf } from "./comparison-text";
import styles from "./ComparisonView.module.css";

export type CompareColumnsProps = {
  plan: readonly PlanEntry[];
  facets: readonly LoupeFacet[];
  comparison: PlanComparison;
  signatureOf: SignatureOf;
};

function selectorList(selectors: readonly Hex4[], signatureOf: SignatureOf) {
  return (
    <ul className={styles.selectors}>
      {selectors.map((hex) => (
        <li key={hex}>
          <code className={sheet.mono}>{denseSelector(hex, signatureOf)}</code>
        </li>
      ))}
    </ul>
  );
}

/**
 * Two columns, "Plan" and "facets()": each plan entry (facet, short address, selector count) beside each
 * loupe facet (short address, selector count), with "Missing on chain", "Not in the plan" and "Moved" marked
 * in words and the accent.
 */
export function CompareColumns({ plan, facets, comparison, signatureOf }: CompareColumnsProps) {
  const planId = useId();
  const loupeId = useId();
  const missingOf = new Map(comparison.missing.map((entry) => [entry.facet, entry.selectors]));
  const extraOf = new Map(comparison.extra.map((entry) => [entry.address.toLowerCase(), entry.selectors]));
  return (
    <>
      <div className={styles.columns}>
        <section aria-labelledby={planId} className={styles.column}>
          <h3 id={planId} className={sheet.sectionLabel}>
            Plan
          </h3>
          <ul className={sheet.list}>
            {plan.map((entry) => {
              const missing = missingOf.get(entry.facet);
              return (
                <li key={entry.facet} className={sheet.item}>
                  <span className={`${sheet.text} ${sheet.strong}`}>{entry.facet}</span>
                  <span className={sheet.mono} title={entry.address}>
                    {formatAddress(entry.address)}
                  </span>
                  <span className={sheet.muted}>{plural(entry.selectors.length, "selector")}</span>
                  {missing ? (
                    <div className={styles.difference}>
                      <p className={styles.mark}>Missing on chain</p>
                      {selectorList(missing, signatureOf)}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
        <section aria-labelledby={loupeId} className={styles.column}>
          <h3 id={loupeId} className={`${sheet.sectionLabel} ${styles.codeLabel}`}>
            facets()
          </h3>
          <ul className={sheet.list}>
            {facets.map((facet) => {
              const extra = extraOf.get(facet.facetAddress.toLowerCase());
              return (
                <li key={facet.facetAddress} className={sheet.item}>
                  <span className={sheet.mono} title={facet.facetAddress}>
                    {formatAddress(facet.facetAddress)}
                  </span>
                  <span className={sheet.muted}>{plural(facet.functionSelectors.length, "selector")}</span>
                  {extra ? (
                    <div className={styles.difference}>
                      <p className={styles.mark}>Not in the plan</p>
                      {selectorList(extra, signatureOf)}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      {comparison.moved.length > 0 ? (
        <ul className={sheet.list} aria-label="Moved selectors">
            {comparison.moved.map((entry) => (
              <li key={entry.selector} className={sheet.item}>
                <div className={styles.difference}>
                  <p className={styles.mark}>Moved</p>
                  <code className={sheet.mono}>{denseSelector(entry.selector, signatureOf)}</code>
                  <span className={sheet.muted}>
                    Planned at{" "}
                    <span className={sheet.mono} title={entry.expected}>
                      {formatAddress(entry.expected)}
                    </span>
                    , on chain at{" "}
                    <span className={sheet.mono} title={entry.actual}>
                      {formatAddress(entry.actual)}
                    </span>
                  </span>
                </div>
              </li>
            ))}
        </ul>
      ) : null}
    </>
  );
}
