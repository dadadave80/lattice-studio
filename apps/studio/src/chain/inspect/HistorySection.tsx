import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Section } from "@/panels/inspector/shared/Section";
import sheet from "@/panels/inspector/shared/sheet.module.css";
import { Button, Select, TextField } from "@/ui";
import type { ReadyInspection } from "./engine";
import { getHistoryController, getHyperRpcToken, setHyperRpcToken, subscribeHyperRpcToken } from "./history-runtime";
import styles from "./CallForm.module.css";

type HistoryController = ReturnType<typeof getHistoryController>;
type HistoryReader = Pick<HistoryController, "get" | "subscribe" | "read" | "cancel">;

/** Optional history is an explicit read. Credentials stay in session memory, separate from project data. */
export function HistorySection({ value, controller = getHistoryController() }: { value: ReadyInspection; controller?: HistoryReader }) {
  const target = useMemo(() => ({ ...value.target, block: value.snapshot.block, blockHash: value.snapshot.blockHash, identity: value.identity }),
    [value.target, value.snapshot.block, value.snapshot.blockHash, value.identity]);
  const state = useSyncExternalStore(controller.subscribe, () => controller.get(target));
  const token = useSyncExternalStore(subscribeHyperRpcToken, getHyperRpcToken);
  const [tokenEdit, setTokenEdit] = useState({ saved: token, text: token });
  const tokenDraft = tokenEdit.saved === token ? tokenEdit.text : token;
  const [provider, setProvider] = useState<"rpc" | "hyperrpc">("rpc");
  const [start, setStart] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const shownEvents = state.status === "ready" ? state.value.history.slice(-100).reverse() : [];
  useEffect(() => () => { controller.cancel(target); }, [controller, target]);
  const read = async () => {
    setError(null);
    if (provider === "hyperrpc" && !commitToken()) return;
    if (start.trim() === "" && provider === "rpc") { setError("Enter the first block to scan."); return; }
    const fromBlock = start.trim() === "" ? undefined : Number(start.trim());
    if (fromBlock !== undefined && (!/^\d+$/.test(start.trim()) || !Number.isSafeInteger(fromBlock) || fromBlock < 0 || fromBlock > target.block)) {
      setError(`Enter a whole block number between 0 and ${target.block}.`); return;
    }
    await controller.read(target, { provider, ...(fromBlock === undefined ? {} : { fromBlock }) });
  };
  const commitToken = (next = tokenDraft): boolean => {
    controller.cancel(target);
    const changed = setHyperRpcToken(next);
    setTokenError(changed.ok ? null : changed.error);
    if (changed.ok) setTokenEdit({ saved: getHyperRpcToken(), text: getHyperRpcToken() });
    return changed.ok;
  };
  return <Section label="History">
    <div className={styles.form}>
      <Select label="History provider" value={provider} options={[{ value: "rpc", label: "Normal RPC" }, { value: "hyperrpc", label: "HyperRPC" }]}
        onValueChange={(next) => { controller.cancel(target); setProvider(next); setError(null); }} />
      <TextField label="First block" value={start} error={error} inputMode="numeric" mono
        description={provider === "rpc" ? "Normal RPC reads need a starting block. Earlier events will not be read." : "Leave empty to request all logs from genesis on a supported chain."}
        onValueChange={(next) => { controller.cancel(target); setStart(next); setError(null); }} />
      {provider === "hyperrpc" ? <>
        <TextField label="HyperRPC token" type="password" value={tokenDraft} error={tokenError} autoComplete="off"
          description="Optional provider access. The token stays in this tab and is sent only to the supported HyperRPC provider."
          onValueChange={(text) => { setTokenEdit({ saved: token, text }); setTokenError(null); }} onBlur={() => commitToken()}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitToken(); } }} />
        {tokenDraft ? <Button size="small" onClick={() => commitToken("")}>Clear token</Button> : null}
      </> : null}
      <div className={sheet.actions}>
        <Button disabledReason={state.status === "loading" ? "Reading history…" : null} onClick={() => void read()}>{state.status === "error" ? "Retry history" : "Read history"}</Button>
        {state.status === "loading" ? <Button onClick={() => controller.cancel(target)}>Cancel history</Button> : null}
      </div>
      {state.status === "not-read" ? <output className={sheet.text}>{state.reason ?? "History not read."}</output> : null}
      {state.status === "loading" ? <output className={sheet.text}>Reading history…</output> : null}
      {state.status === "error" ? <output className={sheet.text}>{state.reason}</output> : null}
      {state.status === "ready" ? <>
        <p className={sheet.strong}>{state.value.coverage === "full" ? `Full log history: blocks ${state.value.fromBlock}–${state.value.toBlock}.` : `Partial history: blocks ${state.value.fromBlock}–${state.value.toBlock}. Earlier events were not read.`}</p>
        <p className={sheet.muted}>{`Read through ${state.value.source === "hyperrpc" ? "HyperRPC" : "normal RPC"} at the inspected block ${target.block}.`}</p>
        <p className={sheet.muted}>{state.value.deployment ? `Creation transaction verified at block ${state.value.deployment.block}.` : "Creation transaction not verified."}</p>
        {state.value.history.length > shownEvents.length ? <p className={sheet.muted}>{`Showing the latest ${shownEvents.length} of ${state.value.history.length} cut events.`}</p> : null}
        {state.value.history.length === 0 ? <p className={sheet.text}>No DiamondCut events in this range.</p> : <ul className={sheet.list} aria-label="DiamondCut history">{shownEvents.map((event) => <li className={sheet.item} key={`${event.txHash}:${event.logIndex}`}>
          <details><summary className={sheet.text}>{`Block ${event.block} · ${event.cuts.length} ${event.cuts.length === 1 ? "cut" : "cuts"}`}</summary>
            <p className={`${sheet.mono} ${styles.raw}`}>{event.txHash}</p>
            <p className={`${sheet.mono} ${styles.raw}`}>{`Initializer ${event.init}`}</p>
            <ul className={sheet.list}>{event.cuts.map((cut, index) => <li key={index} className={sheet.item}>
              <span className={sheet.strong}>{`${cut.action} · ${cut.selectors.length} selectors`}</span>
              <span className={`${sheet.mono} ${styles.raw}`}>{cut.facet}</span>
              <span className={`${sheet.mono} ${styles.raw}`}>{cut.selectors.join(" · ")}</span>
            </li>)}</ul>
          </details>
        </li>)}</ul>}
      </> : null}
    </div>
  </Section>;
}
