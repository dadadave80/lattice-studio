import { usePrediction } from "@/state";
import { explorerUrl, louperUrl, useDeployStatus } from "../shared/use-deploy-status";
import styles from "./CutPlanFooter.module.css";

/** The diamond's address under the cut plan: predicted, or live with explorer and Louper links (spec L384). */
export function DiamondAddress() {
  const prediction = usePrediction();
  const { status, chains } = useDeployStatus();
  const live = status.state === "live" ? status.deployment : undefined;
  const path = live?.path ?? (prediction.status === "ready" ? prediction.path : null);
  const pathName = path === "createx" ? "CreateX" : "LatticeFactory";
  const explorer = live ? explorerUrl(chains, live.chainId, live.address) : null;

  return (
    <div className={styles.addressBlock}>
      <div className={styles.head}>
        <span className={styles.label}>
          {`${pathName} · deterministic`}
        </span>
        <span className={live ? `${styles.aside} ${styles.live}` : styles.aside}>{live ? "Live" : "Predicted"}</span>
      </div>
      {live ? (
        <>
          <p className={`${styles.fullAddress} ${styles.live}`}>{live.address}</p>
          <p className={styles.links}>
            {explorer ? (
              <a className={styles.link} href={explorer} target="_blank" rel="noreferrer">
                Open in explorer
              </a>
            ) : null}
            <a className={styles.link} href={louperUrl(chains, live.chainId, live.address)} target="_blank" rel="noreferrer">
              Open in Louper
            </a>
          </p>
        </>
      ) : prediction.status === "ready" ? (
        <p className={styles.fullAddress}>{prediction.address}</p>
      ) : (
        <p className={styles.empty}>{prediction.reason}</p>
      )}
    </div>
  );
}
