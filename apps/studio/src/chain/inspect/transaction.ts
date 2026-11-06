import { isAddress, isHexAnyCase, sameAddress, type Address, type Hex, type Result, type TxRequest } from "@lattice-studio/core";
import type { ChainInfo } from "@/contracts/chain";
import type { DeployChainPort, DeployClock, ReceiptOutcome, SimulationOutcome } from "../deploy/ports";
import type { DiamondSnapshot, SnapshotReadError } from "./snapshot";

export type TransactionIntent = { chainId: number; tx: TxRequest; snapshot: DiamondSnapshot; contextKey?: string };
export type TransactionReview = TransactionIntent & {
  from: Address;
  contextKey: string;
  gas: bigint;
  simulation: Extract<SimulationOutcome, { kind: "ok" }>;
};
export type TransactionState = {
  phase: "idle" | "reviewing" | "ready" | "checking" | "signing" | "pending" | "stale" | "rejected" | "failed" | "confirmed" | "cancelled";
  review?: TransactionReview;
  error?: string;
  revertData?: Hex;
  hash?: Hex;
  receipt?: Extract<ReceiptOutcome, { kind: "receipt" }>;
  verificationPending?: boolean;
};
export type TransactionDeps = {
  chains: readonly Pick<ChainInfo, "id" | "testnet">[];
  chain(): Promise<DeployChainPort>;
  inspect(chainId: number, address: Address, signal: AbortSignal): Promise<Result<DiamondSnapshot, SnapshotReadError>>;
  context(): { key: string; online: boolean; readOnly: string | null };
  subscribe(listener: () => void): () => void;
  clock: DeployClock;
  receiptTimeout(): number;
  /** Trusted policy for the freshly hash-pinned snapshot, before simulation. Unknown policy can defer. */
  authorize?(review: Pick<TransactionReview, "chainId" | "tx" | "snapshot" | "from" | "contextKey">, snapshot: DiamondSnapshot): Promise<Result<void, string>>;
  beforeSign?(review: TransactionReview): Promise<Result<void, string>>;
  /** Releases only this review's reservation when the wallet was never asked or definitively rejected.
   * An error after handing the request to the wallet is ambiguous and never calls this hook. */
  onUnsent?(review: TransactionReview): Promise<void>;
  /** Also called when a speed-up changes the hash. Never reads the current project identity. */
  onSent?(review: TransactionReview, hash: Hex): Promise<void>;
  onReceipt?(review: TransactionReview, receipt: ReceiptOutcome): Promise<void>;
  onSuccess?(review: TransactionReview): Promise<void>;
};

/** Ignores block advance and loupe order; binds runtime, exact routing, facet code and observed ownership. */
export function transactionSnapshotIdentity(snapshot: DiamondSnapshot): string {
  return JSON.stringify({
    code: snapshot.code.toLowerCase(),
    facets: snapshot.facets?.map((row) => [row.facetAddress.toLowerCase(), row.functionSelectors.map((selector) => selector.toLowerCase()).sort()]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) ?? null,
    codehashes: Object.entries(snapshot.codehashes).map(([address, hash]) => [address.toLowerCase(), hash.toLowerCase()]).sort((a, b) => a[0]!.localeCompare(b[0]!)),
    ownerRouted: snapshot.ownerRouted, owner: snapshot.owner?.toLowerCase() ?? null,
  });
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}

/** Independent review/send/watch lifecycle for an existing contract. Opening or reviewing never sends. */
export function createTransactionController(deps: TransactionDeps) {
  let state: TransactionState = { phase: "idle" };
  let epoch = 0;
  let disposed = false;
  let port: DeployChainPort | null = null;
  let abort = new AbortController();
  let timer: unknown = null;
  let trackingWrites: Promise<void> = Promise.resolve();
  let trackingFailed = false;
  let watching = false;
  const listeners = new Set<() => void>();
  const publish = (next: TransactionState) => { if (!disposed) { state = next; for (const listener of listeners) listener(); } };
  const fail = (error: string, data?: Hex) => publish({ ...state, phase: "failed", error, ...(data === undefined ? {} : { revertData: data }) });
  const active = (generation: number) => !disposed && epoch === generation && !abort.signal.aborted;
  const locked = () => ["signing", "pending", "stale"].includes(state.phase);
  const stopTimer = () => { if (timer !== null) deps.clock.clearTimeout(timer); timer = null; };
  const waitTimer = () => {
    stopTimer();
    const seconds = deps.receiptTimeout();
    timer = deps.clock.setTimeout(() => {
      timer = null;
      if (state.phase === "pending") publish({ ...state, phase: "stale", error: "The transaction hasn't been confirmed yet. Keep waiting or check the wallet." });
    }, (Number.isFinite(seconds) && seconds > 0 ? seconds : 180) * 1000);
  };
  const matches = (review: Pick<TransactionReview, "from" | "chainId" | "contextKey">): string | null => {
    const context = deps.context();
    if (!context.online) return "Sending a transaction needs a connection.";
    if (context.readOnly !== null) return context.readOnly;
    if (context.key !== review.contextKey) return "The reviewed inputs changed. Review the transaction again.";
    const account = port?.account();
    if (!account || !sameAddress(account.address, review.from)) return "The connected account changed. Review the transaction again.";
    if (account.chainId !== review.chainId) return "Switch the wallet to the reviewed chain, then review again.";
    return null;
  };

  const check = async (review: Pick<TransactionReview, "chainId" | "tx" | "snapshot" | "from" | "contextKey">, generation: number): Promise<TransactionReview | null> => {
    const reason = matches(review);
    if (reason !== null) { fail(reason); return null; }
    const baseline = transactionSnapshotIdentity(review.snapshot);
    const read = await deps.inspect(review.chainId, review.tx.to, abort.signal);
    if (!active(generation)) return null;
    if (!read.ok) { fail(read.error.reason); return null; }
    if (transactionSnapshotIdentity(read.value) !== baseline) { fail("The contract's code, routing or owner changed. Review the transaction again."); return null; }
    const authorization = await deps.authorize?.(review, read.value);
    if (!active(generation)) return null;
    if (authorization && !authorization.ok) { fail(authorization.error); return null; }
    const authorizedContext = matches(review);
    if (authorizedContext !== null) { fail(authorizedContext); return null; }
    const readiness = await port!.probe(review.chainId, { refresh: true });
    if (!active(generation)) return null;
    if (!readiness.ok) { fail(readiness.error); return null; }
    if (readiness.value.chainId !== review.chainId || !/^[1-9]\d*$/.test(readiness.value.gasCap ?? "")) { fail("The transaction gas cap couldn't be read for this chain."); return null; }
    const simulation = await port!.simulate(review.chainId, { from: review.from, tx: review.tx, simulateV1: readiness.value.simulate });
    if (!active(generation)) return null;
    if (simulation.kind !== "ok") {
      if (simulation.kind === "reverted") fail("The transaction simulation reverted.", simulation.data);
      else fail(simulation.message);
      return null;
    }
    if (typeof simulation.gas !== "bigint" || simulation.gas <= 0n) { fail("The transaction needs a valid gas estimate before signing."); return null; }
    if (simulation.gas > BigInt(readiness.value.gasCap!)) { fail("The estimated transaction exceeds this chain's gas cap."); return null; }
    const after = await deps.inspect(review.chainId, review.tx.to, abort.signal);
    if (!active(generation)) return null;
    if (!after.ok) { fail(after.error.reason); return null; }
    if (transactionSnapshotIdentity(after.value) !== baseline) { fail("The contract's code, routing or owner changed. Review the transaction again."); return null; }
    const changed = matches(review);
    if (changed !== null) { fail(changed); return null; }
    return freeze({ ...review, snapshot: structuredClone(after.value), gas: simulation.gas, simulation: { ...simulation } });
  };

  const saveSent = (review: TransactionReview, hash: Hex, generation: number): Promise<void> => {
    trackingWrites = trackingWrites.then(async () => {
      try { await deps.onSent?.(review, hash); }
      catch { if (active(generation)) { trackingFailed = true; publish({ ...state, verificationPending: true, error: "The transaction was sent, but its tracking record couldn't be saved. Keep this transaction hash." }); } }
    });
    return trackingWrites;
  };
  const watch = async (review: TransactionReview, hash: Hex, generation: number) => {
    watching = true;
    try {
      const receipt = await port!.watch(review.chainId, hash, {
        from: review.from, signal: abort.signal,
        onRepriced(next) {
          if (!active(generation)) return;
          publish({ ...state, hash: next });
          void saveSent(review, next, generation);
        },
      });
      if (!active(generation) || receipt.kind === "aborted") return;
      stopTimer();
      if (receipt.kind === "receipt" && receipt.status === "success") {
        publish({ phase: "confirmed", review, hash: receipt.hash, receipt, verificationPending: true });
      }
      await trackingWrites;
      let hookFailed = trackingFailed;
      try { await deps.onReceipt?.(review, receipt); } catch { hookFailed = true; }
      if (!active(generation)) return;
      if (receipt.kind === "replaced") {
        if (hookFailed) {
          publish({ ...state, phase: "stale", error: "A replacement was reported, but its tracking couldn't be verified. Keep the original hash and resume observation." });
          return;
        }
        publish({ ...state, phase: "cancelled", hash: receipt.hash, error: receipt.reason === "cancelled" ? "The transaction was canceled in the wallet." : "Another transaction replaced this call." });
        return;
      }
      if (receipt.status === "reverted") {
        const data = await port!.replay(review.chainId, receipt.hash);
        if (active(generation)) publish({ ...state, phase: "failed", hash: receipt.hash, receipt, error: "The transaction reverted on-chain.", ...(data === null ? {} : { revertData: data }) });
        return;
      }
      publish({ phase: "confirmed", review, hash: receipt.hash, receipt, verificationPending: true, ...(hookFailed ? { error: "A success receipt was observed, but its record couldn't be verified or saved. Verification is still needed." } : {}) });
      try { await deps.onSuccess?.(review); }
      catch { hookFailed = true; if (active(generation)) publish({ ...state, error: "The transaction succeeded, but inspection couldn't be refreshed. Refresh it before another call." }); }
      if (active(generation) && !hookFailed) publish({ ...state, verificationPending: false });
    } catch { if (active(generation) && state.phase !== "confirmed") publish({ ...state, phase: "stale", error: "The transaction was sent, but confirmation couldn't be read. Check the wallet." }); }
    finally { if (active(generation)) watching = false; }
  };

  const unsubscribe = deps.subscribe(() => {
    if (!["reviewing", "ready", "checking", "rejected"].includes(state.phase) || !state.review) return;
    const reason = matches(state.review);
    if (reason !== null) { epoch++; abort.abort(); fail(reason); }
  });

  return {
    get(): TransactionState { return state; },
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async review(input: TransactionIntent): Promise<void> {
      if (disposed || locked()) return;
      const generation = ++epoch;
      trackingFailed = false;
      abort.abort(); abort = new AbortController(); stopTimer();
      publish({ phase: "reviewing" });
      if (!deps.chains.some((chain) => chain.id === input.chainId && chain.testnet) || !Number.isSafeInteger(input.chainId) || input.chainId <= 0
        || !isAddress(input.tx.to) || sameAddress(input.tx.to, "0x0000000000000000000000000000000000000000") || !isHexAnyCase(input.tx.data)
        || typeof input.tx.value !== "bigint" || input.tx.value < 0n || input.tx.value >= 1n << 256n
        || input.snapshot.code === "0x" || input.snapshot.facets === null) { fail("Choose a supported chain, deployed diamond and valid transaction data/value."); return; }
      try {
        const copied = freeze({ ...input, tx: { ...input.tx }, snapshot: structuredClone(input.snapshot), contextKey: input.contextKey ?? deps.context().key });
        const loaded = await deps.chain();
        if (!active(generation)) return;
        port = loaded;
        const account = port.account();
        if (!account) { fail("Connect a wallet before reviewing this transaction."); return; }
        const base = freeze({ ...copied, from: account.address });
        const checked = await check(base, generation);
        if (checked !== null && active(generation)) publish({ phase: "ready", review: checked });
      } catch { if (active(generation)) fail("The transaction couldn't be reviewed. Retry the review."); }
    },
    async sign(): Promise<void> {
      const reviewed = state.review;
      if (disposed || !reviewed || !["ready", "rejected"].includes(state.phase)) return;
      const generation = epoch;
      let attempt = reviewed;
      let walletAsked = false;
      let rejected = false;
      publish({ phase: "checking", review: reviewed });
      try {
        const fresh = await check(reviewed, generation);
        if (fresh === null || !active(generation)) return;
        attempt = fresh;
        const allowed = await deps.beforeSign?.(fresh);
        if (!active(generation)) return;
        if (allowed && !allowed.ok) { fail(allowed.error); return; }
        const afterHook = await deps.inspect(fresh.chainId, fresh.tx.to, abort.signal);
        if (!active(generation)) return;
        if (!afterHook.ok) { fail(afterHook.error.reason); return; }
        if (transactionSnapshotIdentity(afterHook.value) !== transactionSnapshotIdentity(fresh.snapshot)) { fail("The contract's code, routing or owner changed. Review the transaction again."); return; }
        const changed = matches(fresh);
        if (changed !== null) { fail(changed); return; }
        publish({ phase: "signing", review: fresh });
        walletAsked = true;
        const sent = await port!.send(fresh.chainId, { from: fresh.from, tx: fresh.tx, gas: fresh.gas });
        rejected = sent.kind === "rejected";
        if (sent.kind !== "sent") {
          if (active(generation)) publish({ phase: sent.kind === "rejected" ? "rejected" : "failed", review: fresh, error: sent.kind === "rejected" ? "The wallet request was rejected." : sent.message });
          return;
        }
        if (active(generation)) publish({ phase: "pending", review: fresh, hash: sent.value });
        const saved = saveSent(fresh, sent.value, generation);
        if (!active(generation)) return;
        waitTimer();
        void watch(fresh, sent.value, generation);
        await saved;
      } catch { if (active(generation)) fail("The transaction request couldn't finish. Check the wallet before trying again."); }
      finally {
        if (!walletAsked || rejected) {
          try { await deps.onUnsent?.(attempt); }
          catch { if (active(generation)) publish({ ...state, verificationPending: true, error: "The transaction wasn't sent, but its review reservation couldn't be cleared. Check tracking before trying again." }); }
        }
      }
    },
    keepWaiting(): void {
      if (state.phase !== "stale") return;
      const { error: _error, ...rest } = state;
      publish({ ...rest, phase: "pending" }); waitTimer();
      if (!watching && state.review && state.hash) void watch(state.review, state.hash, epoch);
    },
    async checkWallet(): Promise<void> {
      if (!state.hash || !state.review || !port || !["pending", "stale"].includes(state.phase)) return;
      const generation = epoch;
      const hash = state.hash;
      try {
        const result = await port.transactionStatus(state.review.chainId, hash);
        if (!active(generation) || state.hash !== hash) return;
        publish({ ...state, error: result.ok ? result.value === "unknown" ? "The RPC doesn't know this transaction. Check the wallet; this review won't resend it." : "The transaction is still being tracked." : result.error });
        if (!watching && state.review && state.hash) void watch(state.review, state.hash, generation);
      } catch { if (active(generation) && state.hash === hash) publish({ ...state, error: "The transaction status couldn't be read. Check the wallet." }); }
    },
    cancel(): void {
      if (disposed || locked()) return;
      epoch++; abort.abort(); stopTimer(); publish({ phase: "cancelled", error: "Transaction review was canceled." });
    },
    dispose(): void { disposed = true; epoch++; abort.abort(); stopTimer(); unsubscribe(); listeners.clear(); },
  };
}

export type TransactionController = ReturnType<typeof createTransactionController>;
