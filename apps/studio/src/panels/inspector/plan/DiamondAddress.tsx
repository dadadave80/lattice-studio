import { useDocument } from "@/contracts";
import { usePrediction } from "@/state";
import { useDeployStatus } from "../shared/use-deploy-status";
import { LiveNextSteps } from "./LiveNextSteps";
import styles from "./CutPlanFooter.module.css";

/**
 * The diamond's address under the cut plan (board 06): predicted, or why there's none yet; once live on the
 * selected chain, the live address in the accent with the Live badge and next steps (spec L384, L578).
 */
export function DiamondAddress() {
  const prediction = usePrediction();
  const projectPath = useDocument((s) => s.project.deploy.path);
  const { status, chains } = useDeployStatus();
  const live = status.state === "live" ? status.deployment : undefined;
  const path = live?.path ?? (prediction.status === "ready" ? prediction.path : projectPath);
  const pathName = path === "createx" ? "CreateX" : "LatticeFactory";

  return (
    <div className={styles.addressBlock}>
      <div className={styles.head}>
        <span className={styles.label}>{`${pathName} · deterministic`}</span>
        <span className={live ? `${styles.aside} ${styles.live}` : styles.aside}>{live ? "Live" : "Predicted"}</span>
      </div>
      {live ? (
        <>
          <p className={`${styles.fullAddress} ${styles.live}`}>{live.address}</p>
          <LiveNextSteps record={live} chains={chains} />
        </>
      ) : prediction.status === "ready" ? (
        <p className={styles.fullAddress}>{prediction.address}</p>
      ) : (
        <p className={styles.empty}>{prediction.reason}</p>
      )}
    </div>
  );
}
