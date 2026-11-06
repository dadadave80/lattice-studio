import type { Deployment, Hex, Result } from "@lattice-studio/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSession } from "@/contracts";
import sheet from "@/panels/inspector/shared/sheet.module.css";
import { Button, TextField } from "@/ui";
import * as upgradeRuntime from "../upgrade-runtime";
import styles from "../CallForm.module.css";

type RecoveryRuntime = Pick<typeof upgradeRuntime, "getUpgradeTracking" | "subscribeUpgradeTracking" | "resumeUpgrade" | "stopUpgradeObservation" | "discardUpgradeProposal">;

/** Recovery observes the saved call. Leaving this view keeps an active observation running. */
export function UpgradeRecovery({ record, online, runtime = upgradeRuntime }: { record: Deployment; online: boolean; runtime?: RecoveryRuntime }) {
  const { chainId, address, pendingUpgrade: pending } = record;
  const tracking = useSyncExternalStore(runtime.subscribeUpgradeTracking, () => runtime.getUpgradeTracking(chainId, address));
  const readOnly = useSession((state) => state.readOnly);
  const [hash, setHash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, [runtime, chainId, address]);
  if (!pending) return null;
  const run = async (action: () => Promise<Result<void, string>>) => {
    const current = ++generation.current;
    setError(null); setBusy(true);
    try {
      const result = await action();
      if (current === generation.current && !result.ok) setError(result.error);
    } catch {
      if (current === generation.current) setError("The saved upgrade couldn't be updated. Check browser storage and retry.");
    } finally { if (current === generation.current) setBusy(false); }
  };
  const observe = () => {
    const typed = hash.trim();
    if (!pending.tx && !/^0x[0-9a-fA-F]{64}$/.test(typed)) { setError("Enter a 32-byte transaction hash."); return; }
    void run(() => runtime.resumeUpgrade(chainId, address, pending.tx ? {} : { txHash: typed as Hex }));
  };
  const blocked = readOnly ?? (!online ? "Reconnect to observe the saved upgrade." : busy ? "Updating the saved upgrade…" : !pending.call ? "This saved upgrade has no exact call to verify. Studio cannot safely attach a recovery hash." : null);
  return <section aria-label="Saved upgrade recovery" className={styles.form}>
    <p className={sheet.strong}>{pending.phase === "signing" && !pending.tx ? "Wallet outcome unknown" : pending.phase === "proposed" && !pending.tx ? "Safe proposal execution not verified" : pending.phase === "verifying" ? "Upgrade awaiting verification" : "Unresolved upgrade"}</p>
    <p className={sheet.muted}>The previous confirmed revision stays recorded until the exact call, receipt and resulting diamond are verified. Observation never resends the transaction.</p>
    {pending.tx ? <p className={`${sheet.mono} ${styles.raw}`}>{pending.tx}</p> : <TextField label="Executed transaction hash" value={hash} mono error={error}
      description={pending.phase === "signing" ? "Check the wallet for the submitted transaction. An unknown wallet outcome cannot be discarded." : "After the Safe executes this proposal, enter its transaction hash. Direct calls and a single Safe Call can be verified."}
      onValueChange={(next) => { setHash(next); setError(null); }} />}
    {pending.tx && error ? <output className={sheet.text}>{error}</output> : null}
    {tracking.reason ? <output className={sheet.text}>{tracking.reason}</output> : tracking.status === "watching" ? <output className={sheet.text}>Observing the saved transaction…</output> : tracking.status === "verified" ? <output className={sheet.text}>Upgrade receipt and resulting diamond verified.</output> : null}
    {pending.phase === "proposed" && !pending.tx && !pending.callsId ? <p className={sheet.muted}>Discarding removes saved proposal tracking. It does not cancel the proposal in Safe.</p> : null}
    <div className={sheet.actions}>
      {tracking.status === "watching" ? <Button size="small" onClick={() => runtime.stopUpgradeObservation(chainId, address)}>Stop observation</Button> : <Button size="small" disabledReason={blocked} onClick={observe}>{pending.tx ? "Resume observation" : "Observe transaction"}</Button>}
      {pending.phase === "proposed" && !pending.tx && !pending.callsId ? <Button size="small" disabledReason={readOnly ?? (busy ? "Updating the saved upgrade…" : null)} onClick={() => void run(() => runtime.discardUpgradeProposal(chainId, address))}>Discard upgrade proposal</Button> : null}
    </div>
  </section>;
}
