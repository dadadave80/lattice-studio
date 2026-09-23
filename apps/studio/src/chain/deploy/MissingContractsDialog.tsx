import { formatAddress, formatGas, plural } from "@lattice-studio/core";
import { useEffect, useId, useSyncExternalStore } from "react";
import { closeDialog, deployController, useSession, type DialogComponentProps } from "@/contracts";
import { Button, Dialog } from "@/ui";
import { MISSING_DESCRIPTION, MISSING_TITLE } from "./copy";
import { appDeployMachine } from "./controller";
import type { MissingItem, MissingStep } from "./machine";
import styles from "./MissingContractsDialog.module.css";

/** The words each contract's state shows (Flow 12 step 3: Pending, Deployed or Failed with Retry). */
const STATUS_WORD: Record<MissingItem["status"], string> = {
  missing: "Missing",
  pending: "Pending",
  deployed: "Deployed",
  failed: "Failed",
};

function summary(step: MissingStep): string {
  const open = step.items.filter((item) => item.status !== "deployed");
  const gas = open.reduce((total, item) => total + (item.gas ?? 0n), 0n);
  const known = open.every((item) => item.gas !== undefined);
  const count = plural(open.length, "contract");
  return gas > 0n && known ? `${count} to deploy · ${formatGas(gas)}` : `${count} to deploy`;
}

/**
 * Deploy missing contracts (Flow 12 step 3, IR L235), opened from the review's Network section when NET-03 fires.
 * Each facet, init contract, and the registry and factory where the chain has none, deploys through Arachnid's proxy
 * at its release address; each row shows Pending, Deployed or Failed with Retry and why it failed. The machine reads
 * the chain again before every send, so the step is safe to repeat. No board yet: built from the dialog primitive
 * and the review's section rows.
 */
export function MissingContractsDialog({ entry, top }: DialogComponentProps<"missing-contracts">) {
  const machine = appDeployMachine();
  const step = useSyncExternalStore(machine.subscribeMissing, machine.missingStep);
  // The second tab is read-only (spec L503): it can watch the step, not send.
  const readOnly = useSession((s) => s.readOnly);
  const { chainId } = entry.props;
  const names = entry.props.names ?? [];
  const namesKey = names.join(",");
  const statusId = useId();
  const close = () => closeDialog("missing-contracts");

  useEffect(() => {
    // The review, the title block and the console read the machine through the contracts' mirror.
    deployController().catch(() => {});
    if (machine.missingStep().running) return;
    void machine.prepareMissing(chainId, namesKey === "" ? [] : namesKey.split(","));
  }, [machine, chainId, namesKey]);

  const busy = step.running || step.preparing;
  const toDeploy = step.items.filter((item) => item.status === "missing" || item.status === "failed").map((item) => item.name);
  const primaryReason = readOnly !== null
    ? readOnly
    : step.running
    ? "Deploying…"
    : step.preparing
      ? "Reading the chain…"
      : toDeploy.length === 0
        ? "Every contract is on this chain."
        : null;
  const progress = step.running
    ? `Deploying ${plural(step.items.filter((item) => item.status === "pending").length, "contract")}…`
    : step.preparing
      ? "Reading the chain…"
      : summary(step);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={MISSING_TITLE}
      description={MISSING_DESCRIPTION}
      top={top}
      size="wide"
      footer={
        <>
          <Button onClick={close}>{busy ? "Close" : "Cancel"}</Button>
          <Button
            variant="primary"
            disabledReason={primaryReason}
            aria-describedby={statusId}
            onClick={() => void machine.deployMissing(toDeploy)}
          >
            {`Deploy ${plural(toDeploy.length, "contract")}`}
          </Button>
        </>
      }
    >
      <output id={statusId} className={styles.status}>
        {progress}
      </output>
      {step.error ? (
        <p className={styles.error} role="alert">
          {step.error}
        </p>
      ) : null}
      <ul className={styles.rows} aria-label="Missing contracts">
        {step.items.map((item) => (
          <li key={item.name} className={styles.row} data-status={item.status}>
            <span className={styles.name}>{item.name}</span>
            <code className={styles.address} title={item.address}>
              {formatAddress(item.address)}
            </code>
            <span className={styles.gas}>{item.gas === undefined ? "" : formatGas(item.gas)}</span>
            <span className={styles.state}>
              <span className={styles.mark} aria-hidden="true" />
              {STATUS_WORD[item.status]}
            </span>
            {item.status === "failed" ? (
              <span className={styles.retry}>
                <Button
                  size="small"
                  disabledReason={readOnly ?? (step.running ? "Deploying…" : null)}
                  aria-label={`Retry ${item.name}`}
                  onClick={() => void machine.deployMissing([item.name])}
                >
                  Retry
                </Button>
              </span>
            ) : null}
            {item.reason ? <p className={styles.reason}>{item.reason}</p> : null}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
