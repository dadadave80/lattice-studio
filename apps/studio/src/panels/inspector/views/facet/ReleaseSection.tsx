import type { Facet } from "@lattice-studio/core";
import { Section } from "../../shared/Section";
import { SpecRow } from "../../shared/SpecRow";
import { SpecRows } from "../../shared/SpecRows";
import { ChainStatusRow } from "./ChainStatusRow";
import { SourceLink } from "./SourceLink";

/**
 * Release (IR L118): the shared contract's address (the same on every chain), its codehash, whether it's on
 * the selected chain (Facet view only; the preview shows availability per chain instead), and the source at
 * the pinned tag.
 */
export function ReleaseSection({ facet, chainStatus }: { facet: Facet; chainStatus: boolean }) {
  return (
    <Section label="Release" aside={facet.release.version}>
      <SpecRows>
        <SpecRow label="Address">{facet.release.address}</SpecRow>
        <SpecRow label="Codehash">{facet.release.codehash}</SpecRow>
        {chainStatus ? <ChainStatusRow facet={facet} /> : null}
        <SpecRow label="Source">
          <SourceLink facet={facet} />
        </SpecRow>
      </SpecRows>
    </Section>
  );
}
