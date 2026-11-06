import { err, isAddress, ok, toChecksum, type Address, type Hex, type Result } from "@lattice-studio/core";
import type { Abi } from "viem";
import { callValue, decodeCallOutputs, decodeCallRevert, encodeCall, type CallOutput, type CallRevert, type RoutedFunction } from "./abi";

export type CallContext = {
  chainId: number; address: Address; block: number; blockHash: Hex; identity: string; fn: RoutedFunction; abi: Abi;
};
export type CallDraft = { args: readonly string[]; caller: string; value: string };
export type PreparedCall = { data: Hex; value: bigint; from?: Address };
type CallResult = { outputs: CallOutput[]; raw: Hex; block: number };
type Validation = { fieldErrors: Record<number, string>; callerError: string | null; valueError: string | null };
export type CallState = Validation & {
  identity: string; draft: CallDraft;
  phase: "idle" | "resolving" | "calling" | "success" | "revert" | "error";
  result: CallResult | null; revert: CallRevert | null; raw: Hex | null; message: string | null;
};
export type CallPorts = {
  resolve(name: string, chainId: number): Promise<Result<Address | null, string>>;
  call(chainId: number, to: Address, data: Hex, options: { blockHash: Hex; from?: Address; value: bigint }): Promise<Result<Hex, { reason: string; data: Hex | null }>>;
};
type Entry = { state: CallState; generation: number };
const keyOf = (context: CallContext) => `${context.chainId}:${context.address.toLowerCase()}:${context.fn.signature}`;
const empty = (identity: string, draft: CallDraft): CallState => ({
  identity, draft, phase: "idle", fieldErrors: {}, callerError: null, valueError: null, result: null, revert: null, raw: null, message: null,
});

async function resolveAddress(text: string, chainId: number, ports: CallPorts): Promise<Result<string, string>> {
  if (isAddress(text)) return ok(toChecksum(text));
  if (!text.includes(".") || /[\s:/#]/.test(text) || text.startsWith("0x")) return ok(text);
  try {
    const resolved = await ports.resolve(text, chainId);
    if (!resolved.ok) return err("This name couldn't be resolved. Try again or enter its address.");
    if (resolved.value === null) return err(`No address is set for ${text} on this chain.`);
    return isAddress(resolved.value) ? ok(toChecksum(resolved.value)) : err("This name returned an invalid address.");
  } catch { return err("This name couldn't be resolved. Try again or enter its address."); }
}

async function prepare(context: CallContext, draft: CallDraft, ports: CallPorts): Promise<Result<PreparedCall, Validation>> {
  const validation: Validation = { fieldErrors: {}, callerError: null, valueError: null };
  const texts = [...draft.args];
  for (const [index, input] of context.fn.abi.inputs.entries()) {
    if (input.type !== "address") continue;
    const resolved = await resolveAddress(texts[index]?.trim() ?? "", context.chainId, ports);
    if (resolved.ok) texts[index] = resolved.value;
    else validation.fieldErrors[index] = resolved.error;
  }
  let from: Address | undefined;
  if (draft.caller.trim() !== "") {
    const caller = await resolveAddress(draft.caller.trim(), context.chainId, ports);
    if (!caller.ok) validation.callerError = caller.error;
    else if (!isAddress(caller.value)) validation.callerError = "Enter a valid caller address or ENS name.";
    else from = toChecksum(caller.value);
  }
  const encoded = encodeCall(context.fn.abi, texts);
  if (!encoded.ok) for (const error of encoded.error) {
    if (error.index !== null && validation.fieldErrors[error.index] === undefined) validation.fieldErrors[error.index] = error.message;
  }
  const value = callValue(context.fn.abi, draft.value);
  if (!value.ok) validation.valueError = value.error;
  if (Object.keys(validation.fieldErrors).length || validation.callerError || validation.valueError || !encoded.ok || !value.ok) return err(validation);
  return ok({ data: encoded.value.data, value: value.value, ...(from ? { from } : {}) });
}

/** Session-only drafts and observed call results. No recipe, wallet prompt, persistence or clock. */
export function createCallController(ports: CallPorts) {
  const entries = new Map<string, Entry>();
  const drafts = new Map<string, CallDraft>();
  const results = new Map<string, CallResult>();
  const listeners = new Set<() => void>();
  let disposed = false;
  const notify = () => { for (const listener of listeners) listener(); };
  const entryOf = (context: CallContext): Entry => {
    const draftKey = keyOf(context);
    const key = `${draftKey}:${context.identity}`;
    let entry = entries.get(key);
    if (!entry) {
      const draft = drafts.get(draftKey);
      entry = { state: empty(context.identity, draft && draft.args.length === context.fn.abi.inputs.length ? draft : { args: context.fn.abi.inputs.map(() => ""), caller: "", value: "" }), generation: 0 };
      entries.set(key, entry);
    }
    return entry;
  };
  const prepareEntry = async (context: CallContext) => {
    if (disposed) return null;
    const entry = entryOf(context);
    const generation = ++entry.generation;
    const current = () => !disposed && entry.generation === generation && entry.state.identity === context.identity;
    entry.state = { ...empty(context.identity, entry.state.draft), phase: "resolving" };
    notify();
    const prepared = await prepare(context, entry.state.draft, ports);
    if (!current()) return null;
    if (!prepared.ok) {
      entry.state = { ...entry.state, ...prepared.error, phase: "error", message: "Check the call fields." };
      notify();
      return null;
    }
    return { entry, current, prepared: prepared.value };
  };
  return {
    get(context: CallContext): CallState { return entryOf(context).state; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    patch(context: CallContext, patch: Partial<CallDraft>): void {
      if (disposed) return;
      const entry = entryOf(context);
      entry.generation++;
      entry.state = empty(context.identity, { ...entry.state.draft, ...patch, ...(patch.args ? { args: [...patch.args] } : {}) });
      drafts.set(keyOf(context), entry.state.draft);
      notify();
    },
    async prepare(context: CallContext): Promise<PreparedCall | null> {
      const captured = await prepareEntry(context);
      if (!captured) return null;
      captured.entry.state = { ...captured.entry.state, phase: "idle" };
      notify();
      return captured.prepared;
    },
    async run(context: CallContext): Promise<void> {
      if (!context.fn.readOnly) return;
      const captured = await prepareEntry(context);
      if (!captured) return;
      const { entry, current, prepared } = captured;
      const key = [context.identity, context.blockHash, context.chainId, context.address.toLowerCase(), context.fn.selector, prepared.data, prepared.from?.toLowerCase() ?? "", prepared.value].join(":");
      const cached = results.get(key);
      if (cached) { entry.state = { ...entry.state, phase: "success", result: cached }; notify(); return; }
      entry.state = { ...entry.state, phase: "calling" };
      notify();
      try {
        const result = await ports.call(context.chainId, context.address, prepared.data, { blockHash: context.blockHash, ...(prepared.from ? { from: prepared.from } : {}), value: prepared.value });
        if (!current()) return;
        if (!result.ok) {
          entry.state = { ...entry.state, phase: result.error.data === null ? "error" : "revert", message: result.error.reason,
            revert: result.error.data === null ? null : decodeCallRevert(context.abi, result.error.data), raw: result.error.data };
        } else {
          const decoded = decodeCallOutputs(context.fn.abi, result.value);
          if (!decoded.ok) entry.state = { ...entry.state, phase: "error", message: "The returned data couldn't be decoded with this ABI.", raw: result.value };
          else {
            const value = { outputs: decoded.value, raw: result.value, block: context.block };
            results.set(key, value);
            entry.state = { ...entry.state, phase: "success", result: value };
          }
        }
      } catch { if (current()) entry.state = { ...entry.state, phase: "error", message: "This call couldn't be completed. Try again." }; }
      if (current()) notify();
    },
    cancel(context: CallContext): void {
      const entry = entryOf(context);
      entry.generation++;
      if (entry.state.phase === "calling" || entry.state.phase === "resolving") {
        entry.state = empty(context.identity, entry.state.draft);
        notify();
      }
    },
    invalidate(): void { results.clear(); for (const entry of entries.values()) { entry.generation++; entry.state = empty(entry.state.identity, entry.state.draft); } notify(); },
    dispose(): void { disposed = true; entries.clear(); drafts.clear(); results.clear(); listeners.clear(); },
  };
}
export type CallController = ReturnType<typeof createCallController>;
