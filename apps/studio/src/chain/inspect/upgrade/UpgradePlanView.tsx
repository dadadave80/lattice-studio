import { useState, useSyncExternalStore } from "react";
import { commandRef, useAnalysis, useDocument } from "@/contracts";
import { chainNameOf } from "@/panels/inspector/shared/use-chain";
import { Section } from "@/panels/inspector/shared/Section";
import { SpecRow } from "@/panels/inspector/shared/SpecRow";
import { SpecRows } from "@/panels/inspector/shared/SpecRows";
import { ViewHeader } from "@/panels/inspector/shared/ViewHeader";
import { DeploymentsList } from "@/panels/inspector/views/diamond/DeploymentsList";
import sheet from "@/panels/inspector/shared/sheet.module.css";
import { Button, CommandButton, Select, copyText } from "@/ui";
import { getUpgradePreparation, subscribeUpgradePreparation } from "../upgrade-review-ports";
import styles from "../CallForm.module.css";
import { useUpgradePlan } from "./use-upgrade-plan";

const ACTION = ["Add", "Replace", "Remove"] as const;

export function UpgradePlanView() {
  const projectId = useDocument((state) => state.project.id);
  const name = useDocument((state) => state.project.name);
  const hash = useAnalysis((analysis) => analysis.recipeHash);
  const problems = useAnalysis((analysis) => analysis.problems);
  const preparation = useSyncExternalStore(subscribeUpgradePreparation, getUpgradePreparation);
  const { recipe, origin, catalog, plan } = useUpgradePlan();
  const [selectedInit, setSelectedInit] = useState<string | null>(null);
  const initSpec = catalog?.inits.find((spec) => spec.name === selectedInit);
  const retainedOpaque = recipe.facets.some((id) => {
    const instance = recipe.facetInstances?.[id];
    return instance && (instance.kind !== "known" || instance.extraSelectors.length > 0);
  });
  const state = preparation?.projectId === projectId && preparation.recipeHash === hash ? preparation : null;
  return <div className={sheet.view} data-view="upgrade-plan">
    <ViewHeader title={name} kind="Upgrade plan" />
    <Section label="Stored target"><SpecRows>
      <SpecRow label="Chain">{origin ? chainNameOf(null, origin.chainId) : "Unknown"}</SpecRow>
      <SpecRow label="Diamond"><span className={styles.raw}>{origin?.address ?? "No stored target"}</span></SpecRow>
      <SpecRow label="Baseline block">{origin?.block ?? "Unknown"}</SpecRow>
    </SpecRows><p className={sheet.muted}>Review rechecks the live target before changing it.</p>
    <div className={sheet.actions}>
      <CommandButton command={commandRef("deploy.upgrade")} variant="primary">Upgrade…</CommandButton>
      {origin ? <CommandButton command={commandRef("inspect.open", { chainId: origin.chainId, target: origin.address })}>Back to inspection</CommandButton> : null}
      <CommandButton command={commandRef("inspect.showProgress")} size="small">Transaction progress</CommandButton>
    </div></Section>
    {state?.status === "checking" || state?.status === "error" ? <Section label="Preparation"><output className={sheet.text}>{state.reason ?? "Checking the live upgrade target…"}</output></Section> : null}
    <Section label="Diff against baseline">
      {!plan.ok ? <output className={sheet.text}>{plan.error}</output> : plan.value.cuts.length === 0 ? <p className={sheet.text}>No selector changes.</p> : <ul className={sheet.list} aria-label="Upgrade diff">{plan.value.cuts.map((cut, index) => <li key={index} className={sheet.item}>
        <span className={sheet.strong}>{`${ACTION[cut.action]} · ${cut.functionSelectors.length} selectors`}</span>
        {cut.action !== 2 ? <span className={`${sheet.mono} ${styles.raw}`}>{cut.facetAddress}</span> : null}
        <span className={`${sheet.mono} ${styles.raw}`}>{cut.functionSelectors.join(" · ")}</span>
      </li>)}</ul>}
      {plan.ok ? <div className={sheet.actions}><Button size="small" onClick={() => void copyText(JSON.stringify(plan.value.cuts, null, 2), { label: "upgrade diff" })}>Copy upgrade diff</Button></div> : null}
    </Section>
    <Section label="New initializer">
      <p className={sheet.text}>{recipe.init.kind === "none" ? "No initializer requested." : recipe.init.kind === "bundle" ? `${recipe.init.spec} (bundle)` : recipe.init.steps.length ? recipe.init.steps.map((step) => step.spec).join(" → ") : "No initializer requested."}</p>
      <p className={sheet.muted}>Add only an initializer you intend to run for this upgrade. Original initialization is not replayed.</p>
      {catalog ? <Select label="Choose a new initializer" value={selectedInit} placeholder="No new initializer selected" options={catalog.inits.map((spec) => ({ value: spec.name, label: `${spec.name}${spec.kind === "bundle" ? " (bundle)" : ""}` }))} onValueChange={setSelectedInit} /> : null}
      <div className={sheet.actions}>
        {initSpec ? <CommandButton command={initSpec.kind === "bundle" ? commandRef("init.useBundle", { spec: initSpec.name }) : commandRef("init.addStep", { spec: initSpec.name })}>{initSpec.kind === "bundle" ? "Use new bundle" : "Add new step"}</CommandButton> : null}
        {recipe.init.kind !== "none" ? <CommandButton command={commandRef("init.open")}>Edit initializer</CommandButton> : null}
      </div>
    </Section>
    {retainedOpaque ? <Section label="Compatibility coverage"><p className={sheet.muted}>Retained raw selectors and built-in functions have no checked storage, initializer or authority compatibility. Review calls out any acknowledgement required for this plan.</p></Section> : null}
    {problems.length ? <Section label="Plan checks"><p className={sheet.text}>{`${problems.filter((problem) => problem.severity === "blocker").length} blockers · ${problems.filter((problem) => problem.severity === "warning").length} warnings`}</p><div className={sheet.actions}><CommandButton command={commandRef("problem.next")}>Review plan checks</CommandButton></div></Section> : null}
    <DeploymentsList autoCheck={false} />
  </div>;
}
