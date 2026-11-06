import type { PassportIdentifiedFacet } from "@lattice-studio/core";
import { commandRef, type InspectorViewProps } from "@/contracts";
import { Section } from "@/panels/inspector/shared/Section";
import { SpecRow } from "@/panels/inspector/shared/SpecRow";
import { SpecRows } from "@/panels/inspector/shared/SpecRows";
import { ViewHeader } from "@/panels/inspector/shared/ViewHeader";
import sheet from "@/panels/inspector/shared/sheet.module.css";
import { Button, CommandButton } from "@/ui";
import { Identifier } from "@/ui/text/Identifier";
import { facetMetadata, facetTitle } from "./facet-metadata";
import type { InspectionEngine, ReadyInspection } from "./engine";
import { useInspection } from "./use-inspection";
import { useInspectionCatalogs } from "./use-inspection-catalogs";
import styles from "./DeployedView.module.css";
import { FacetFunctions } from "./FacetFunctions";

type Props = InspectorViewProps<"deployed"> & { engine?: InspectionEngine };

function FacetDetails({ facet, value }: { facet: PassportIdentifiedFacet; value: ReadyInspection }) {
  const catalogs = useInspectionCatalogs();
  const metadata = facetMetadata(facet, catalogs);
  const catalog = catalogs.find((item) => item.lattice.tag === facet.catalog && item.facets.includes(metadata!));
  const signature = new Map(metadata?.selectors.map((selector) => [selector.hex.toLowerCase(), selector.signature]));
  return <>
    <Section label="Facet">
      <SpecRows>
        <SpecRow label="Address"><span className={styles.hex}>{facet.address}</span></SpecRow>
        <SpecRow label="Identity">{facet.kind === "known" ? "Catalog runtime codehash match" : facet.kind === "self" ? "Functions built into the diamond" : "No bundled catalog match"}</SpecRow>
        <SpecRow label="Codehash"><span className={styles.hex}>{facet.codehash ?? "Not identified separately"}</span></SpecRow>
        {facet.kind === "known" ? <>
          <SpecRow label="Release">{`${facet.name} ${facet.version} · ${facet.catalog}`}</SpecRow>
          <SpecRow label="Metadata">{metadata ? metadata.summary : "Catalog metadata is unavailable."}</SpecRow>
        </> : null}
      </SpecRows>
    </Section>
    {metadata ? <Section label="Storage">
      <p className={sheet.muted}>Catalog storage layout; storage values have not been read.</p>
      <SpecRows>
        <SpecRow label="Namespace"><Identifier text={metadata.storage?.id ?? "none"} /></SpecRow>
        <SpecRow label="Slot"><span className={styles.hex}>{metadata.storage?.slot ?? "none"}</span></SpecRow>
        <SpecRow label="Touches">{metadata.touches.length ? metadata.touches.map((name) => <span key={name}><Identifier text={name} /> </span>) : "none"}</SpecRow>
      </SpecRows>
    </Section> : null}
    <Section label="Selectors" aside={`${facet.selectors.length} routed`}>
      <ul className={sheet.list} aria-label="Routed selectors">
        {facet.selectors.map((selector) => <li className={sheet.item} key={selector}>
          <span className={sheet.mono}>{selector}</span>
          {signature.has(selector) ? <Identifier text={signature.get(selector)!} /> : <span className={sheet.muted}>Signature unknown</span>}
        </li>)}
      </ul>
      <p className={sheet.muted}>{`Observed on ${value.chainName} at block ${value.snapshot.block}.`}</p>
    </Section>
    {metadata && catalog ? <FacetFunctions value={value} facet={facet} metadata={metadata} catalog={catalog}    /> : <Section label="Functions"><p className={sheet.muted}>Functions can't be called without a verified ABI.</p></Section>}
  </>;
}

function DiamondDetails({ value }: { value: ReadyInspection }) {
  const { target, snapshot, passport } = value;
  const selectors = value.facets.reduce((count, facet) => count + facet.selectors.length, 0);
  return <>
    <Section label="Facets" aside={`${value.facets.length} facets · ${selectors} selectors`}>
      {value.facets.length === 0 ? <p className={sheet.muted}>The loupe reports no routed facets.</p> : <ul className={sheet.list} aria-label="Facets">
        {value.facets.map((facet) => <li className={sheet.item} key={facet.address.toLowerCase()}>
          <span className={sheet.strong}>{facetTitle(facet)}</span>
          <span className={`${sheet.mono} ${styles.hex}`}>{facet.address}</span>
          <span className={sheet.muted}>{`${facet.selectors.length} selectors${facet.version ? ` · ${facet.version}` : ""}`}</span>
          <div className={sheet.actions}><CommandButton size="small" command={commandRef("inspect.selectFacet", { ...target, facetAddress: facet.address })}>
            {facet.kind === "known" ? `Inspect ${facetTitle(facet)}` : facet.kind === "self" ? "Inspect diamond itself" : "Inspect unknown facet"}
          </CommandButton></div>
        </li>)}
      </ul>}
    </Section>
    <Section label="Authority">
      <p className={sheet.text}>{!snapshot.ownerRouted ? "owner() is not routed." : snapshot.owner === null ? "owner() is routed but its value couldn't be read." : <span className={styles.hex}>{snapshot.owner}</span>}</p>
      <p className={sheet.muted}>This observation does not describe every role or permission in the diamond.</p>
    </Section>
    <Section label="Passport">
      <p className={sheet.muted}>These checks describe the observed snapshot. They do not audit contract behavior.</p>
      <ul className={sheet.list} aria-label="Passport checks">{passport.claims.map((claim) => <li className={sheet.item} key={claim.id}>
        <span className={sheet.strong}>{`${claim.id} · ${{ pass: "Pass", fail: "Fail", warn: "Warning", skip: "Not checked" }[claim.status]}`}</span>
        <span className={sheet.text}>{claim.message}</span>
      </li>)}</ul>
      <p className={`${sheet.mono} ${styles.hex}`}>{`Digest ${passport.digest}`}</p>
    </Section>
  </>;
}

/** A chain observation, isolated from the editable composition and its analysis. */
export function DeployedView({ view, engine }: Props) {
  const state = useInspection(view, engine);
  const value = "value" in state ? state.value : null;
  const facet = value?.facets.find((item) => item.address.toLowerCase() === view.facetAddress?.toLowerCase());
  const ready = state.status === "ready";
  const title = view.facetAddress ? facet ? facetTitle(facet) : "Deployed facet" : value?.primaryName ?? "Deployed diamond";
  return <div className={sheet.view} data-view="deployed">
    <ViewHeader title={title} kind="On chain" />
    <Section label="Diamond">
      <SpecRows>
        <SpecRow label="Chain">{value?.chainName ?? `Chain ${view.chainId}`}</SpecRow>
        <SpecRow label="Address"><span className={styles.hex}>{view.address}</span></SpecRow>
        {value ? <SpecRow label="Observed block">{value.snapshot.block}</SpecRow> : null}
      </SpecRows>
      <div className={sheet.actions}>
        <CommandButton command={commandRef("inspect.copyAddress", view)} size="small">Copy address</CommandButton>
        <CommandButton command={commandRef("inspect.refresh", view)} size="small">Refresh</CommandButton>
        {value?.explorer ? <a className={sheet.link} href={value.explorer} target="_blank" rel="noreferrer noopener">View on explorer</a> : null}
        {value ? <CommandButton command={commandRef("inspect.exportPassport", view)} size="small">Export passport</CommandButton> : null}
      </div>
    </Section>
    {state.status === "idle" || state.status === "loading" ? <Section label="Inspection"><output className={sheet.text}>Inspecting diamond…</output></Section> : null}
    {state.status === "error" ? <Section label="Inspection"><output className={sheet.text}>{state.reason}</output>
      {engine ? <Button onClick={() => void engine.refresh(view)}>Retry</Button> : <CommandButton command={commandRef("inspect.refresh", view)}>Retry</CommandButton>}
    </Section> : null}
    {state.status === "no-code" || state.status === "not-diamond" ? <Section label="Inspection"><p className={sheet.text}>{state.status === "no-code" ? "No contract code at this address." : "This contract doesn't expose a diamond loupe."}</p></Section> : null}
    {ready && value ? view.facetAddress ? facet ? <FacetDetails facet={facet} value={value} /> : <Section label="Facet"><p className={sheet.text}>This facet isn't routed by the observed diamond.</p></Section> : <DiamondDetails value={value} /> : null}
    <Section label="Navigation"><div className={sheet.actions}>
      {view.facetAddress ? <CommandButton command={commandRef("inspect.selectFacet", { chainId: view.chainId, address: view.address })}>Back to diamond</CommandButton> : null}
      <CommandButton command={commandRef("inspect.close")}>Back to composition</CommandButton>
    </div></Section>
  </div>;
}
