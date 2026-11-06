import { formatAddress } from "@lattice-studio/core";
import { commandRef } from "@/contracts";
import { CommandButton } from "@/ui";
import styles from "@/panels/inspector/plan/CutPlanFooter.module.css";
import { useUpgradePlan } from "./use-upgrade-plan";

export function UpgradePlanFooter() {
  const { origin, plan } = useUpgradePlan();
  const cuts = plan.ok ? plan.value.cuts : [];
  return <section className={styles.footer} aria-label="Upgrade diff" data-upgrade-plan="">
    <div className={styles.planHead}><h2 className={styles.label}>Upgrade diff</h2><CommandButton command={commandRef("deploy.upgrade")} size="small">Upgrade…</CommandButton></div>
    <div className={styles.scroller}>
      {!plan.ok ? <p className={styles.empty}>{plan.error}</p> : cuts.length === 0 ? <p className={styles.empty}>No selector changes.</p> : <ul className={styles.rows}>{cuts.map((cut, index) => <li key={index} className={styles.row}>
        <span className={styles.action}>{["Add", "Replace", "Remove"][cut.action]}</span><span>{`${cut.functionSelectors.length} selectors`}</span>
        {cut.action === 2 ? null : <span className={styles.address} title={cut.facetAddress}>{formatAddress(cut.facetAddress)}</span>}
      </li>)}</ul>}
      {origin ? <p className={styles.fullAddress}>{`Target ${origin.address}`}</p> : null}
    </div>
  </section>;
}
