import { recipeHash } from "@lattice-studio/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useCatalog, useDocument, useSession, type DialogComponentProps } from "@/contracts";
import { Section } from "@/panels/inspector/shared/Section";
import { SpecRow } from "@/panels/inspector/shared/SpecRow";
import { SpecRows } from "@/panels/inspector/shared/SpecRows";
import sheet from "@/panels/inspector/shared/sheet.module.css";
import { Button, Checkbox, Dialog } from "@/ui";
import styles from "../CallForm.module.css";
import { finishUpgradeReview, getUpgradeReview, subscribeUpgradeReview } from "./review";

const ACTION = ["Add", "Replace", "Remove"] as const;
const ZERO = "0x0000000000000000000000000000000000000000";

export function UpgradeReviewDialog({ top }: DialogComponentProps<"upgrade-plan-review">) {
  const request = useSyncExternalStore(subscribeUpgradeReview, getUpgradeReview);
  const project = useDocument((state) => state.project);
  const catalog = useCatalog();
  const readOnly = useSession((state) => state.readOnly);
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => () => { if (getUpgradeReview() === request) finishUpgradeReview({ accepted: false, opaqueAcknowledged: false }); }, [request]);
  if (!request) return null;
  const { details } = request;
  const stale = project.id !== details.projectId || catalog?.hash.toLowerCase() !== details.catalogHash.toLowerCase() || recipeHash(project.recipe, catalog ?? undefined) !== details.recipeHash;
  const empty = details.cuts.length === 0 && details.init.target.toLowerCase() === ZERO && details.init.data === "0x";
  const reason = readOnly ?? (stale ? "The plan changed. Close this review and run Upgrade again." : empty ? "This plan makes no changes." : details.requiresOpaqueAcknowledgement && !acknowledged ? "Acknowledge the retained code's compatibility limits." : null);
  const close = () => finishUpgradeReview({ accepted: false, opaqueAcknowledged: false });
  return <Dialog open title="Review upgrade" description="This changes the existing diamond at the stored target. Review the exact selector cuts and any new initializer." top={top} size="wide" lossless initialFocus="title" onOpenChange={(open) => { if (!open) close(); }}
    footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" disabledReason={reason} onClick={() => finishUpgradeReview({ accepted: true, opaqueAcknowledged: acknowledged })}>Continue to transaction review</Button></>}>
    <Section label="Stored target"><SpecRows>
      <SpecRow label="Chain">{details.chainName}</SpecRow>
      <SpecRow label="Diamond"><span className={styles.raw}>{details.diamond}</span></SpecRow>
      <SpecRow label="From"><span className={styles.raw}>{details.from}</span></SpecRow>
      <SpecRow label="Baseline block">{details.baselineBlock}</SpecRow>
      <SpecRow label="Checked block">{details.observedBlock}</SpecRow>
    </SpecRows></Section>
    {stale || readOnly ? <Section label="Plan status"><output className={sheet.text}>{reason}</output></Section> : null}
    <Section label="Selector changes" aside={ACTION.map((action, index) => `${details.cuts.filter((cut) => cut.action === index).reduce((count, cut) => count + cut.functionSelectors.length, 0)} ${action}`).join(" · ")}>
      <ul className={sheet.list} aria-label="Exact upgrade cuts">{details.cuts.map((cut, index) => <li className={sheet.item} key={index}>
        <span className={sheet.strong}>{`${ACTION[cut.action]} · ${cut.functionSelectors.length} selectors`}</span>
        {cut.action === 2 ? <p className={sheet.muted}>These selectors will no longer route through this diamond.</p> : <span className={`${sheet.mono} ${styles.raw}`}>{cut.facetAddress}</span>}
        <span className={`${sheet.mono} ${styles.raw}`}>{cut.functionSelectors.join(" · ")}</span>
      </li>)}</ul>
      {details.cuts.length === 0 ? <p className={sheet.muted}>No selector changes.</p> : null}
    </Section>
    <Section label="New initializer">
      {details.init.target.toLowerCase() === ZERO && details.init.data === "0x" ? <p className={sheet.text}>No initializer requested.</p> : <>
        <p className={sheet.text}>{details.init.steps.length ? details.init.steps.join(" → ") : "Explicit initializer call"}</p>
        <p className={`${sheet.mono} ${styles.raw}`}>{details.init.target}</p>
        <details><summary>Initializer calldata</summary><pre className={styles.raw}>{details.init.data}</pre></details>
      </>}
    </Section>
    <Section label="Upgrade authority"><p className={sheet.text}>{details.authority.explanation}</p></Section>
    {details.opaque.length ? <Section label="Retained code coverage">
      <p className={sheet.text}>Studio cannot check retained foreign code or built-in functions for storage, initializer or authority compatibility.</p>
      <ul className={sheet.list}>{details.opaque.map((facet, index) => <li className={sheet.item} key={index}>
        <span className={sheet.strong}>{`${facet.label} · ${facet.selectors.length} selectors`}</span>
        <span className={`${sheet.mono} ${styles.raw}`}>{facet.address}</span>
        <span className={`${sheet.mono} ${styles.raw}`}>{facet.codehash}</span>
      </li>)}</ul>
      {details.requiresOpaqueAcknowledgement ? <Checkbox label="I understand retained code has not been checked for storage, initializer or authority compatibility." checked={acknowledged} onCheckedChange={setAcknowledged} /> : null}
    </Section> : null}
  </Dialog>;
}
