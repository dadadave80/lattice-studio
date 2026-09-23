import type { InspectorViewProps } from "@/contracts";
import { commandRef, useCatalog } from "@/contracts";
import { CommandButton } from "@/ui";
import { Section } from "../../shared/Section";
import { ViewHeader } from "../../shared/ViewHeader";
import styles from "../../shared/sheet.module.css";
import { FacetSheet } from "./FacetSheet";

/**
 * The Facet view (IR L118): a placed facet's spec sheet, its problems (spec L382), its Selectors list acting
 * like its pins (Flow 6), storage, requirements, seams, init and release, with Flip pins, Locate, Move to…
 * and Remove.
 */
export function FacetView({ view }: InspectorViewProps<"facet">) {
  const catalog = useCatalog();
  const facet = catalog?.facets.find((entry) => entry.name === view.facet);
  return (
    <div className={styles.view} data-view="facet">
      <ViewHeader title={view.facet} kind="Facet" />
      {!catalog ? (
        <div className={styles.section}>
          <p className={styles.muted}>Loading the catalog…</p>
        </div>
      ) : !facet ? (
        <div className={styles.section}>
          <p className={styles.muted}>{view.facet} isn't in the catalog.</p>
        </div>
      ) : (
        <>
          <FacetSheet facet={facet} catalog={catalog} readOnly={false} />
          <Section label="Actions">
            <div className={styles.actions}>
              <CommandButton command={commandRef("layout.flipPins", { facets: [facet.name] })} size="small">
                Flip pins
              </CommandButton>
              <CommandButton command={commandRef("sheet.locate", { facet: facet.name })} size="small">
                Locate
              </CommandButton>
              <CommandButton command={commandRef("sheet.moveTo")} size="small">
                Move to…
              </CommandButton>
              <CommandButton command={commandRef("facet.remove", { facets: [facet.name] })} size="small">
                Remove
              </CommandButton>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
