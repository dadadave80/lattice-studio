import { coreStatus, mechanismOptions } from "@lattice-studio/core";
import { useMemo } from "react";
import { useAnalysis, useCatalog, useDocument } from "@/contracts";
import { Section } from "../../shared/Section";
import { SpecRow } from "../../shared/SpecRow";
import { SpecRows } from "../../shared/SpecRows";
import sheet from "../../shared/sheet.module.css";
import { cutText, erc165Text, fallbackText, loupeRows, loupeText } from "./core-words";
import styles from "./diamond.module.css";

/**
 * The core, the diamond's fixed part (the first section of the Diamond view): the proxy's fallback and what it
 * routes, the loupe's four selectors, the ERC-165 interfaces the init registers, and the cut facet with its
 * upgrade mechanism. Reads `coreStatus`, the same readout the console's `core` verb prints.
 */
export function CoreSection() {
  const recipe = useDocument((s) => s.project.recipe);
  const catalog = useCatalog();
  const analysis = useAnalysis();
  const rows = useMemo(() => {
    if (!catalog) return null;
    const status = coreStatus(recipe, catalog, analysis);
    return {
      fallback: fallbackText(status.fallback),
      loupe: loupeText(status.loupe),
      loupeRows: loupeRows(status.loupe, catalog),
      erc165: erc165Text(status.erc165),
      interfaces: status.erc165.interfaceIds,
      cut: cutText(status.cut, mechanismOptions(recipe, catalog)),
    };
  }, [recipe, catalog, analysis]);

  return (
    <Section label="Core">
      {rows === null ? (
        <p className={sheet.muted}>Loading the catalog…</p>
      ) : (
        <SpecRows>
          <SpecRow label="Fallback">{rows.fallback}</SpecRow>
          <SpecRow label="Loupe">
            <span>{rows.loupe}</span>
            <ul className={styles.plainList} aria-label="Loupe selectors">
              {rows.loupeRows.map((row) => (
                <li key={row.hex} className={row.covered ? styles.quiet : `${styles.quiet} ${sheet.accent}`} data-loupe={row.hex}>
                  {`${row.signature} · ${row.hex}`}
                </li>
              ))}
            </ul>
          </SpecRow>
          <SpecRow label="ERC-165">
            <span>{rows.erc165}</span>
            {rows.interfaces.length > 0 ? (
              <ul className={styles.plainList} aria-label="Registered interfaces">
                {rows.interfaces.map((entry) => (
                  <li key={entry.id} className={styles.quiet}>
                    {`${entry.name} · ${entry.id}`}
                  </li>
                ))}
              </ul>
            ) : null}
          </SpecRow>
          <SpecRow label="Cut">{rows.cut}</SpecRow>
        </SpecRows>
      )}
    </Section>
  );
}
