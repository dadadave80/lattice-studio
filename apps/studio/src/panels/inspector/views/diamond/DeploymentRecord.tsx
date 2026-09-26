import type { Deployment, Hex } from "@lattice-studio/core";
import { formatAddress, formatTime } from "@lattice-studio/core";
import { forgeVerifyCommand } from "@/chain/verify/copy";
import { commandRef, now } from "@/contracts";
import { Button } from "@/ui/buttons/Button";
import { CommandButton } from "@/ui/buttons/CommandButton";
import { copyText } from "@/ui/copy/copy-text";
import sheet from "../../shared/sheet.module.css";
import { shortHash, statusWord, verificationFailureReason, verificationWord } from "./diamond-words";
import type { RecordCheck } from "./use-record-checks";
import styles from "./diamond.module.css";

export type DeploymentRecordProps = {
  record: Deployment;
  /** The sheet's recipe hash: a confirmed record with it is live. */
  currentHash: Hex;
  chainName: string;
  /** The explorer page for the address, when the chain module knows the explorer. */
  explorer: string | null;
  /**
   * False only once the chain module has loaded and its list truly lacks this chain id; true while it's still
   * loading or unavailable, since the forge command needs only the chain id already on the record, not the
   * module (spec L606, L661: a disabled reason must be true, not just "we don't know yet").
   */
  chainKnown: boolean;
  check: RecordCheck | undefined;
  /** Offline, the stored verification can't be confirmed, so it reads Unknown (ruling R7, spec L832). */
  online: boolean;
  onRetry(): void;
};

/** One deployment record in the Deployments list (IR L119): status, address, recipe hash, verification, time. */
export function DeploymentRecord({ record, currentHash, chainName, explorer, chainKnown, check, online, onRetry }: DeploymentRecordProps) {
  const { chainId, address } = record;
  const time = formatTime(record.at, new Date(now()).toISOString());
  const failureReason = verificationFailureReason(record, online);
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
      <span className={styles.quiet}>{verificationWord(record.verification, online)}</span>
      {failureReason ? <span className={sheet.text}>{failureReason}</span> : null}
      {check === "found" ? <span className={styles.quiet}>{`Code found on ${chainName}.`}</span> : null}
      {check === "empty" ? <span className={sheet.text}>{`No code at this address on ${chainName}.`}</span> : null}
      {check === "failed" ? (
        <div className={styles.recordError}>
          <p className={sheet.text}>{`Couldn't read ${chainName} for this record.`}</p>
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
          <>
            <CommandButton command={commandRef("deploy.retryVerification", { chainId, address })} size="small">
              Retry verification
            </CommandButton>
            <Button
              size="small"
              disabledReason={chainKnown ? null : "Studio doesn't recognize this chain."}
              onClick={() => void copyText(forgeVerifyCommand(address, chainId), { label: "verify command" })}
            >
              Copy verify command
            </Button>
          </>
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
