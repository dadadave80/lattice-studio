import type { Deployment, Hex } from "@lattice-studio/core";
import { formatAddress, formatTime } from "@lattice-studio/core";
import { commandRef, now } from "@/contracts";
import { Button, CommandButton, copyText } from "@/ui";
import sheet from "../../shared/sheet.module.css";
import { shortHash, statusWord, verificationWord } from "./diamond-words";
import type { RecordCheck } from "./use-record-checks";
import styles from "./diamond.module.css";

export type DeploymentRecordProps = {
  record: Deployment;
  /** The sheet's recipe hash: a confirmed record with it is live. */
  currentHash: Hex;
  chainName: string;
  /** The explorer page for the address, when the chain module knows the explorer. */
  explorer: string | null;
  check: RecordCheck | undefined;
  onRetry(): void;
};

/** One deployment record in the Deployments list (IR L119): status, address, recipe hash, verification, time. */
export function DeploymentRecord({ record, currentHash, chainName, explorer, check, onRetry }: DeploymentRecordProps) {
  const { chainId, address } = record;
  const time = formatTime(record.at, new Date(now()).toISOString());
  return (
    <li className={sheet.item} data-record={`${chainId}:${address}`}>
      <div className={sheet.itemLine}>
        <span className={`${sheet.text} ${sheet.strong}`}>{statusWord(record, currentHash)}</span>
        <time className={styles.quiet} dateTime={record.at} title={time.title}>
          {time.text}
        </time>
      </div>
      <div className={sheet.itemLine}>
        <span className={sheet.mono} title={formatAddress(address, { full: true })}>
          {formatAddress(address)}
        </span>
        <span className={`${sheet.mono} ${styles.quiet}`} title={record.recipeHash}>
          {`recipe ${shortHash(record.recipeHash)}`}
        </span>
      </div>
      <span className={styles.quiet}>{verificationWord(record.verification)}</span>
      {check === "failed" ? (
        <div className={styles.recordError}>
          <p className={sheet.text} role="alert">{`Couldn't read ${chainName} for this record.`}</p>
          <Button size="small" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
      <div className={sheet.actions}>
        <Button size="small" onClick={() => void copyText(address)}>
          Copy address
        </Button>
        {explorer ? (
          <a className={`${sheet.link} ${styles.linkAction}`} href={explorer} target="_blank" rel="noreferrer noopener">
            Open in explorer
          </a>
        ) : null}
        {record.verification === "failed" ? (
          <CommandButton command={commandRef("deploy.retryVerification", { chainId, address })} size="small">
            Retry verification
          </CommandButton>
        ) : null}
        {record.status === "mismatch" ? (
          <CommandButton command={commandRef("deploy.compare", { chainId, address })} size="small">
            Compare with the sheet…
          </CommandButton>
        ) : null}
        {record.status === "proposed" ? (
          <CommandButton command={commandRef("deploy.discardProposal")} size="small">
            Discard proposal
          </CommandButton>
        ) : null}
      </div>
    </li>
  );
}
