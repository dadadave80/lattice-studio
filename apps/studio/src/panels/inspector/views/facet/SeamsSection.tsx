import type { Catalog, Facet } from "@lattice-studio/core";
import { formatSelector } from "@lattice-studio/core";
import { useDocument } from "@/contracts";
import { Section } from "../../shared/Section";
import sheet from "../../shared/sheet.module.css";
import { CodeText } from "./CodeText";
import { servedSeams, signatureOf } from "./facet-model";
import { breakIdentifier } from "@/ui/text/Identifier";

/** Seams it serves (IR L118): active seams this facet is allowed to serve, each selector with its reason. */
export function SeamsSection({ facet, catalog }: { facet: Facet; catalog: Catalog }) {
  const placed = useDocument((s) => s.project.recipe.facets);
  const seams = servedSeams(facet, catalog, placed);
  if (seams.length === 0) return null;
  return (
    <Section label="Seams it serves" aside={`${seams.length}`}>
      <ul className={sheet.list}>
        {seams.map((seam) => {
          const signature = signatureOf(catalog, seam.selector);
          return (
            <li key={seam.selector} className={sheet.item} data-seam={seam.selector}>
              <span className={sheet.mono}>
                {signature === undefined ? breakIdentifier(seam.selector) : <CodeText text={formatSelector({ hex: seam.selector, signature }, "full")} />}
              </span>
              <p className={sheet.muted}>Its version {seam.reason}.</p>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
