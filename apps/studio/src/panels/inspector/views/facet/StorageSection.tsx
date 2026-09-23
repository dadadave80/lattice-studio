import type { Catalog, Facet } from "@lattice-studio/core";
import { useDocument } from "@/contracts";
import { Section } from "../../shared/Section";
import { SpecRow } from "../../shared/SpecRow";
import { SpecRows } from "../../shared/SpecRows";
import { sharedWith } from "./facet-model";

/** Storage (IR L118): its namespace and slot, the namespaces it reads, and the placed facets it shares them with. */
export function StorageSection({ facet, catalog }: { facet: Facet; catalog: Catalog }) {
  const placed = useDocument((s) => s.project.recipe.facets);
  const shared = sharedWith(facet, catalog, placed);
  return (
    <Section label="Storage">
      <SpecRows>
        <SpecRow label="Namespace">{facet.storage?.id ?? "none"}</SpecRow>
        <SpecRow label="Slot">{facet.storage?.slot ?? "none"}</SpecRow>
        <SpecRow label="Reads">{facet.touches.length === 0 ? "none" : facet.touches.join(" · ")}</SpecRow>
        <SpecRow label="Shared with">{shared.length === 0 ? "none" : shared.join(" · ")}</SpecRow>
      </SpecRows>
    </Section>
  );
}
