import type { FacetInstance, Hex4 } from "@lattice-studio/core";
import { commandRef } from "@/contracts";
import { Section } from "@/panels/inspector/shared/Section";
import { SpecRow } from "@/panels/inspector/shared/SpecRow";
import { SpecRows } from "@/panels/inspector/shared/SpecRows";
import { ViewHeader } from "@/panels/inspector/shared/ViewHeader";
import sheet from "@/panels/inspector/shared/sheet.module.css";
import { Button, CommandButton, copyText } from "@/ui";
import styles from "../CallForm.module.css";

export function RawSelectorSection({ selectors, self = false }: { selectors: readonly Hex4[]; self?: boolean }) {
  return <Section label="Raw selectors" aside={`${selectors.length} locked`}>
    <p className={sheet.text}>{self ? "Functions built into the diamond are immutable and cannot be removed or replaced." : "Raw selectors cannot be edited individually. Remove their whole facet instance instead."}</p>
    <ul className={sheet.list} aria-label="Locked raw selectors">{selectors.map((selector) => <li className={`${sheet.item} ${sheet.mono}`} key={selector}>{selector}</li>)}</ul>
  </Section>;
}

export function RawFacetView({ name, instance }: { name: string; instance: Exclude<FacetInstance, { kind: "known" }> }) {
  const title = instance.kind === "self" ? "Diamond itself" : "Foreign facet";
  return <div className={sheet.view} data-view="facet" data-facet={name} data-raw-kind={instance.kind}>
    <ViewHeader title={title} kind={instance.kind === "self" ? "Immutable" : "Raw code"} />
    <Section label="Observed instance"><SpecRows>
      <SpecRow label="Address"><span className={styles.raw}>{instance.address}</span></SpecRow>
      <SpecRow label="Codehash"><span className={styles.raw}>{instance.codehash}</span></SpecRow>
    </SpecRows><p className={sheet.muted}>No trusted ABI, storage layout, initializer or authority metadata is available for these selectors.</p></Section>
    <RawSelectorSection selectors={instance.selectors} self={instance.kind === "self"} />
    <Section label="Actions"><div className={sheet.actions}>
      <Button size="small" onClick={() => void copyText(instance.address)}>Copy address</Button>
      <CommandButton command={commandRef("sheet.locate", { facet: name })} size="small">Locate</CommandButton>
      {instance.kind === "foreign" ? <CommandButton command={commandRef("facet.remove", { facets: [name] })} size="small">Remove whole facet</CommandButton> : null}
    </div></Section>
  </div>;
}
