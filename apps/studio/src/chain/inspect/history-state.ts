import { sameAddress, type Result } from "@lattice-studio/core";
import type { DiamondCutHistory, HistoryReadError } from "@/contracts/chain";
import type { InspectionTarget } from "./engine";
import type { Hex } from "@lattice-studio/core";

export type HistoryTarget = InspectionTarget & { block: number; blockHash: Hex; identity: string };
export type HistoryReadInput = { fromBlock?: number; provider?: "rpc" | "hyperrpc" };
export type HistoryState =
  | { status: "not-read"; reason?: string }
  | { status: "loading" }
  | { status: "error"; reason: string }
  | { status: "ready"; value: DiamondCutHistory };
export type HistoryPorts = {
  read(target: HistoryTarget, input: HistoryReadInput, signal: AbortSignal): Promise<Result<DiamondCutHistory, HistoryReadError>>;
  attach(target: HistoryTarget, value: DiamondCutHistory): boolean;
};
const NOT_READ: HistoryState = { status: "not-read" };
const keyOf = (target: HistoryTarget) => `${target.chainId}:${target.address.toLowerCase()}:${target.blockHash.toLowerCase()}:${target.identity}`;
type Entry = { state: HistoryState; controller: AbortController };

/** Only session facts are cached: credentials and provider exceptions never enter state or cache keys. */
export function createHistoryController(ports: HistoryPorts) {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let disposed = false;
  const notify = () => { for (const listener of listeners) listener(); };
  const cancel = (target?: HistoryTarget) => {
    for (const [key, entry] of entries) {
      if (target && key !== keyOf(target)) continue;
      if (entry.state.status !== "loading") continue;
      entry.controller.abort();
      entry.state = { status: "not-read", reason: "History read was canceled." };
    }
    notify();
  };
  return {
    get(target: HistoryTarget): HistoryState { return entries.get(keyOf(target))?.state ?? NOT_READ; },
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async read(target: HistoryTarget, input: HistoryReadInput = {}): Promise<void> {
      if (disposed) return;
      const captured = { ...target };
      const key = keyOf(captured);
      const prefix = `${captured.chainId}:${captured.address.toLowerCase()}:`;
      for (const [old, entry] of entries) if (old.startsWith(prefix)) { entry.controller.abort(); entries.delete(old); }
      // Bound the memory held by explicit historical scans, even across many inspected addresses.
      while (entries.size >= 8) { const [old, entry] = entries.entries().next().value!; entry.controller.abort(); entries.delete(old); }
      const entry: Entry = { state: { status: "loading" }, controller: new AbortController() };
      entries.set(key, entry); notify();
      const current = () => !disposed && entries.get(key) === entry && !entry.controller.signal.aborted;
      try {
        const result = await ports.read(captured, { ...input }, entry.controller.signal);
        if (!current()) return;
        if (!result.ok) entry.state = { status: "error", reason: result.error.reason };
        else if (result.value.chainId !== captured.chainId || !sameAddress(result.value.address, captured.address)
          || result.value.toBlock !== captured.block || result.value.blockHash.toLowerCase() !== captured.blockHash.toLowerCase()) {
          entry.state = { status: "error", reason: "Inspection changed while history was loading. Read history again." };
        } else if (result.value.coverage === "full" && result.value.deployment !== null && !ports.attach(captured, result.value)) {
          entry.state = { status: "error", reason: "Inspection changed while history was loading. Read history again." };
        } else entry.state = { status: "ready", value: result.value };
      } catch { if (current()) entry.state = { status: "error", reason: "History couldn't be read. Retry the history read." }; }
      if (current()) notify();
    },
    cancel,
    invalidate(target?: HistoryTarget): void {
      if (disposed) return;
      for (const [key, entry] of entries) if (!target || key === keyOf(target)) { entry.controller.abort(); entries.delete(key); }
      notify();
    },
    dispose(): void { disposed = true; for (const entry of entries.values()) entry.controller.abort(); entries.clear(); listeners.clear(); },
  };
}
export type HistoryController = ReturnType<typeof createHistoryController>;
