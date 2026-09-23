import { calldataHash } from "@lattice-studio/core";
import { TextField } from "@/ui";
import { BLIND_SIGNING, HARDWARE_BODY, HARDWARE_SUMMARY, UNAUDITED_NOTICE, confirmMismatch, typeToConfirm } from "./copy";
import { useReview } from "./review-data";
import { setTypedName, useReviewState } from "./review-state";
import styles from "./review.module.css";

/**
 * Under the sections (spec L573): on a mainnet, the unaudited-code notice and the typed confirmation (paste allowed,
 * a mismatch explained in words, spec L792); always, the collapsed "Using a hardware wallet?" note with the calldata
 * hash to compare with the wallet software's data view.
 */
export function ConfirmBlock() {
  const { chainInfo, project, cost } = useReview();
  const typed = useReviewState((s) => s.typedName);
  const mainnet = chainInfo?.testnet === false;
  const hash = cost.deploy.ok ? calldataHash(cost.deploy.value.tx.data) : null;
  const mismatch = typed.trim() !== "" && typed.trim() !== project.name;
  return (
    <>
      {mainnet ? (
        <div className={styles.confirm} data-mainnet-confirm="">
          <p className={styles.line}>{UNAUDITED_NOTICE}</p>
          <TextField
            label={typeToConfirm(project.name)}
            value={typed}
            onValueChange={setTypedName}
            autoComplete="off"
            spellCheck={false}
            error={mismatch ? confirmMismatch(project.name) : null}
          />
        </div>
      ) : null}
      <details className={styles.disclosure} data-hardware-note="">
        <summary>{HARDWARE_SUMMARY}</summary>
        <p className={styles.muted}>{HARDWARE_BODY}</p>
        <dl className={styles.facts}>
          <dt>Calldata hash</dt>
          <dd>{hash ?? (cost.deploy.ok ? "" : cost.deploy.error)}</dd>
        </dl>
        <p className={styles.muted}>{BLIND_SIGNING}</p>
      </details>
    </>
  );
}
