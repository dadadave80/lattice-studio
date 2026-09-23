import type { Facet } from "@lattice-studio/core";
import { VisuallyHidden } from "@/ui";
import { SpecRow } from "../../shared/SpecRow";
import { SpecRows } from "../../shared/SpecRows";
import { cutText, initText, namespaceText, selectorsText, type InitPlacement, type SelectorCounts } from "./facet-model";
import styles from "./facet.module.css";

export type FacetSpecRowsProps = {
  facet: Facet;
  counts: SelectorCounts;
  placement: InitPlacement;
};

/** The spec sheet's head (board 06): Source, Version, Address, Namespace, Slot, Selectors, Init, Cut. */
export function FacetSpecRows({ facet, counts, placement }: FacetSpecRowsProps) {
  return (
    <SpecRows>
      <SpecRow label="Source">{facet.source}</SpecRow>
      <SpecRow label="Version">{facet.release.version}</SpecRow>
      <SpecRow label="Address">{facet.release.address}</SpecRow>
      <SpecRow label="Namespace">{namespaceText(facet)}</SpecRow>
      <SpecRow label="Slot">{facet.storage?.slot ?? "none"}</SpecRow>
      <SpecRow label="Selectors">{selectorsText(counts)}</SpecRow>
      <SpecRow label="Init">{initText(placement)}</SpecRow>
      <SpecRow label="Cut">
        {counts.contested ? (
          <span className={styles.contested} data-contested="">
            {cutText(counts)} <span aria-hidden="true">⟂</span>
            <VisuallyHidden>, contested</VisuallyHidden>
          </span>
        ) : (
          cutText(counts)
        )}
      </SpecRow>
    </SpecRows>
  );
}
