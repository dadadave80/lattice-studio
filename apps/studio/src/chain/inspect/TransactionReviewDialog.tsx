import { exportSafeCall, isAddress, toChecksum } from "@lattice-studio/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { STUDIO_VERSION } from "@/app/version";
import { closeDialog, now, toast, type DialogComponentProps } from "@/contracts";
import { downloadFile } from "@/panels/console/download";
import sheet from "@/panels/inspector/shared/sheet.module.css";
import { Button, Dialog, TextField } from "@/ui";
import { decodeCallRevert } from "./abi";
import { getTransactionReview, subscribeTransactionReview, type TransactionReviewRequest } from "./transaction-review-state";
import styles from "./CallForm.module.css";

function Review({ request, top }: { request: TransactionReviewRequest; top: boolean }) {
  const state = useSyncExternalStore(request.controller.subscribe, request.controller.get);
  const [safe, setSafe] = useState("");
  const [safeError, setSafeError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const locked = ["signing", "pending", "stale"].includes(state.phase);
  const close = () => {
    if (!state.hash && ["reviewing", "ready", "checking", "rejected"].includes(state.phase)) request.controller.cancel();
    closeDialog("inspect-transaction");
  };
  const signable = !request.invalidated && (state.phase === "ready" || state.phase === "rejected");
  const statuses = {
    idle: "Review this transaction before signing.", reviewing: "Checking the transaction…", ready: "Ready for your review. Nothing has been sent.",
    checking: "Checking the transaction again before signing…", signing: "Confirm the transaction in your wallet.", pending: "Waiting for confirmation…",
    stale: "The transaction hasn't been confirmed yet. Keep waiting or check the wallet.", rejected: "The wallet request was rejected. You can retry it.",
    failed: "The transaction couldn't continue.", confirmed: state.verificationPending ? "A success receipt was observed. Studio couldn't finish verification. Keep the transaction hash and check its progress." : `Confirmed${state.receipt ? ` at block ${state.receipt.block}` : " on chain"}.`, cancelled: "Transaction review was canceled.",
  };
  const data = state.revertData ? decodeCallRevert(request.abi, state.revertData) : null;
  const exportSafe = async () => {
    if (request.invalidated || exporting || locked) return;
    if (!isAddress(safe.trim())) { setSafeError("Enter a valid, nonzero Safe address."); return; }
    const address = toChecksum(safe.trim());
    setSafeError(null); setExporting(true);
    let downloaded = false;
    try {
      const checked = await request.beforeSafeExport?.(address);
      if (checked && !checked.ok) { setSafeError(checked.error); return; }
      if (!live.current || getTransactionReview() !== request || request.invalidated || ["signing", "pending", "stale", "confirmed"].includes(request.controller.get().phase)) return;
      const file = exportSafeCall({ safe: address, chainId: request.intent.chainId, tx: request.intent.tx, now: now(), studioVersion: STUDIO_VERSION, label: request.label });
      if (!file.ok) { setSafeError(file.error); return; }
      downloadFile(file.value);
      downloaded = true;
      const saved = await request.onSafeExport?.(address);
      if (saved && !saved.ok) setSafeError(`The Safe call was downloaded. ${saved.error}`);
      toast({ text: "Downloaded a Safe call proposal. Nothing was sent." });
    } catch { setSafeError(downloaded ? "The Safe call was downloaded, but Studio couldn't save its proposal record." : "The Safe call couldn't be exported. Try again."); }
    finally { setExporting(false); }
  };
  return <Dialog open title="Review transaction" description="Check the destination, value and calldata before signing." top={top} lossless initialFocus="title" onOpenChange={(open) => { if (!open) close(); }}
    footer={<><Button onClick={close}>Close</Button>{signable ? <Button variant="primary" disabledReason={exporting ? "Checking the Safe proposal…" : null} onClick={() => void request.controller.sign()}>Sign transaction</Button> : null}</>}>
    <div className={styles.form}>
      <p className={sheet.strong}>{request.label}</p>
      <dl className={styles.outputs}>
        <div><dt className={sheet.muted}>Chain</dt><dd className={styles.output}>{request.intent.chainId}</dd></div>
        <div><dt className={sheet.muted}>Destination</dt><dd className={styles.output}>{request.intent.tx.to}</dd></div>
        <div><dt className={sheet.muted}>Value (wei)</dt><dd className={styles.output}>{request.intent.tx.value.toString()}</dd></div>
        {state.review ? <><div><dt className={sheet.muted}>From</dt><dd className={styles.output}>{state.review.from}</dd></div>
          <div><dt className={sheet.muted}>Gas limit</dt><dd className={styles.output}>{state.review.gas.toString()}</dd></div>
          <div><dt className={sheet.muted}>Simulation</dt><dd className={styles.output}>{`${state.review.simulation.method === "call" ? "eth_call" : "eth_simulateV1"} at block ${state.review.simulation.block}`}</dd></div></> : null}
      </dl>
      {request.args.length ? <dl className={styles.outputs}>{request.args.map((arg, index) => <div key={index}><dt className={sheet.muted}>{`${arg.name} (${arg.type})`}</dt><dd className={styles.output}>{typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value, null, 2)}</dd></div>)}</dl> : null}
      <details><summary>Exact calldata</summary><pre className={styles.raw}>{request.intent.tx.data}</pre></details>
      <output className={sheet.text}>{request.invalidated ? "The call inputs changed. Close this review and review the call again." : statuses[state.phase]}</output>
      {state.error ? <p className={sheet.text}>{state.error}</p> : null}
      {state.hash ? <p className={`${sheet.mono} ${styles.raw}`}>{`Transaction ${state.hash}`}</p> : null}
      {data ? <details><summary>{data.errorName ?? "Revert data"}</summary><pre className={styles.raw}>{JSON.stringify(data, null, 2)}</pre></details> : null}
      {state.phase === "stale" ? <div className={sheet.actions}><Button onClick={() => request.controller.keepWaiting()}>Keep waiting</Button><Button onClick={() => void request.controller.checkWallet()}>Check wallet</Button></div> : null}
      {!request.invalidated && ["failed", "cancelled"].includes(state.phase) ? <Button onClick={() => void request.controller.review(request.intent)}>Review again</Button> : null}
      {!locked && state.phase !== "confirmed" ? <div className={styles.result}>
        <p className={sheet.muted}>A Safe call is a proposal for the exact destination, value and calldata above. Exporting does not execute it.</p>
        <TextField label="Safe address" value={safe} error={safeError} disabledReason={exporting ? "Checking the Safe proposal…" : null} mono onValueChange={(value) => { setSafe(value); setSafeError(null); }} />
        <Button disabledReason={request.invalidated ? "The call inputs changed. Review the call again." : exporting ? "Checking the Safe proposal…" : null} onClick={() => void exportSafe()}>Export Safe call</Button>
      </div> : null}
    </div>
  </Dialog>;
}

export function TransactionReviewDialog({ top }: DialogComponentProps<"inspect-transaction">) {
  const request = useSyncExternalStore(subscribeTransactionReview, getTransactionReview);
  return request ? <Review key={`${request.intent.chainId}:${request.intent.tx.to}:${request.intent.tx.data}:${request.intent.tx.value}`} request={request} top={top} /> : <Dialog open title="Transaction progress" top={top} lossless onOpenChange={(open) => { if (!open) closeDialog("inspect-transaction"); }} footer={<Button onClick={() => closeDialog("inspect-transaction")}>Close</Button>}><p>No transaction has been reviewed in this session.</p></Dialog>;
}
