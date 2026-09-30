import { isCoreFacet } from "@lattice-studio/core";
import type { InspectorViewProps } from "@/contracts";
import { commandRef, useCatalog } from "@/contracts";
import { Button, CommandButton } from "@/ui";
import { CORE_FACET_REASON } from "../../../core-copy";
import { ViewHeader } from "../../shared/ViewHeader";
import sheet from "../../shared/sheet.module.css";
import { FacetSheet } from "../facet/FacetSheet";
import { AvailabilitySection } from "./AvailabilitySection";
import { CompareColumn } from "./CompareColumn";
import styles from "./preview.module.css";

/**
 * The Catalog preview (IR L122): the facet as the Facet view shows it, read-only, plus availability per chain,
 * with Place on sheet (Flow 3). With two or more options (Compare options…, Flow 5), they sit side by side.
 */
export function PreviewView({ view }: InspectorViewProps<"preview">) {
  const catalog = useCatalog();
  const compare = view.compare ?? [];

  if (compare.length >= 2) {
    const options = compare.flatMap((name) => catalog?.facets.find((facet) => facet.name === name) ?? []);
    const unknown = catalog ? compare.filter((name) => !options.some((facet) => facet.name === name)) : [];
    return (
      <div className={sheet.view} data-view="preview">
        <ViewHeader title="Compare options" kind="Catalog preview" />
        {!catalog ? (
          <div className={sheet.section}>
            <p className={sheet.muted}>Loading the catalog…</p>
          </div>
        ) : (
          <>
            <section className={styles.compare} aria-label="Options side by side">
              {options.map((facet) => (
                <CompareColumn key={facet.name} facet={facet} />
              ))}
            </section>
            {unknown.map((name) => (
              <p key={name} className={sheet.muted}>
                {name} isn't in the catalog.
              </p>
            ))}
          </>
        )}
      </div>
    );
  }

  const name = compare[0] ?? view.facet;
  const facet = catalog?.facets.find((entry) => entry.name === name);
  return (
    <div className={sheet.view} data-view="preview">
      <ViewHeader title={name} kind="Catalog preview" />
      {!catalog ? (
        <div className={sheet.section}>
          <p className={sheet.muted}>Loading the catalog…</p>
        </div>
      ) : !facet ? (
        <div className={sheet.section}>
          <p className={sheet.muted}>{name} isn't in the catalog.</p>
        </div>
      ) : (
        <>
          <div className={sheet.section}>
            <div className={sheet.actions}>
              {isCoreFacet(facet.name) ? (
                // Never a card: the core is in every diamond already, so there's nothing to place.
                <Button variant="primary" size="small" disabledReason={CORE_FACET_REASON}>
                  Place on sheet
                </Button>
              ) : (
                <CommandButton command={commandRef("facet.place", { facet: facet.name })} variant="primary" size="small">
                  Place on sheet
                </CommandButton>
              )}
            </div>
          </div>
          <FacetSheet facet={facet} catalog={catalog} readOnly />
          <AvailabilitySection facet={facet.name} />
        </>
      )}
    </div>
  );
}
