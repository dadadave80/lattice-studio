import { encodeInit, err, isAddress, ok, planInit, sameAddress, type Address, type Deployment, type Hex, type Result } from "@lattice-studio/core";
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import type { DeployChainPort, DeployClock } from "../deploy/ports";
import { isDelegation } from "../infra/account";
import type { DiamondSnapshot } from "./snapshot";
import { readUpgradeAuthority } from "./upgrade-authority";
import { checkUpgradeBaseline, checkUpgradeCode, upgradeBaseline, type PreparedUpgrade, type UpgradePreflightPorts } from "./upgrade-preflight";
import { createUpgradeRecordTracker, type UpgradeRecordPorts } from "./upgrade-records";
import { verifyUpgradeEvidence, verifyUpgradeReplacement, verifyUpgradeTransaction, type UpgradeObservedReceipt, type UpgradeObservedTransaction } from "./upgrade-evidence";
import { createTransactionController, type TransactionDeps, type TransactionIntent, type TransactionReview } from "./transaction";

export type UpgradeExecutionPorts = UpgradePreflightPorts & {
  chains: TransactionDeps["chains"];
  chain(): Promise<DeployChainPort>;
  records: UpgradeRecordPorts;
  context: TransactionDeps["context"];
  subscribe: TransactionDeps["subscribe"];
  clock: DeployClock;
  receiptTimeout(): number;
  receipt(chainId: number, hash: Hex): Promise<Result<UpgradeObservedReceipt, string>>;
  transaction(chainId: number, hash: Hex): Promise<Result<UpgradeObservedTransaction, string>>;
  afterSuccess?(): Promise<void>;
};
const SAFE_ABI = parseAbi(["function getThreshold() view returns(uint256)", "function getOwners() view returns(address[])"]);
const ZERO = "0x0000000000000000000000000000000000000000";

async function safeAccount(address: Address, snapshot: DiamondSnapshot, chainId: number, ports: UpgradePreflightPorts): Promise<Result<void, string>> {
  try {
    const code = await ports.codeAt(chainId, address, snapshot.blockHash);
    if (!code.ok || code.value === "0x" || isDelegation(code.value)) return err("The proposed Safe needs its own deployed Safe runtime code.");
    const target = { chainId, address }, options = { blockHash: snapshot.blockHash };
    const [threshold, owners] = await Promise.all([
      ports.call(target, encodeFunctionData({ abi: SAFE_ABI, functionName: "getThreshold" }), options),
      ports.call(target, encodeFunctionData({ abi: SAFE_ABI, functionName: "getOwners" }), options),
    ]);
    if (!threshold.ok || !owners.ok) return err("The proposed Safe's threshold and owners couldn't be read.");
    const minimum = decodeFunctionResult({ abi: SAFE_ABI, functionName: "getThreshold", data: threshold.value });
    const members = decodeFunctionResult({ abi: SAFE_ABI, functionName: "getOwners", data: owners.value });
    if (minimum < 1n || minimum > BigInt(members.length) || new Set(members.map((member) => member.toLowerCase())).size !== members.length
      || members.some((member) => !isAddress(member) || sameAddress(member, ZERO))) return err("The proposed Safe has an invalid threshold or owner list.");
    return ok(undefined);
  } catch { return err("The proposed Safe couldn't be authenticated at the observed block."); }
}

/** One captured plan, original record owner and context key for its whole wallet and receipt lifecycle. */
export function createUpgradeTransaction(prepared: PreparedUpgrade, record: Deployment, ports: UpgradeExecutionPorts) {
  const origin = prepared.project.upgrade!;
  const target = { chainId: origin.chainId, address: origin.address };
  const contextKey = ports.context().key;
  const tracker = createUpgradeRecordTracker({ origin, recipeHash: prepared.plan.analysis.recipeHash, catalogHash: prepared.catalog.hash,
    tx: prepared.tx, expectedFacets: prepared.plan.expectedFacets, expectedCodehashes: prepared.plan.expectedCodehashes }, record, ports.records);
  const sentHashes = new WeakMap<TransactionReview, Hex>();
  const sentFacts = new WeakMap<TransactionReview, Map<Hex, UpgradeObservedTransaction>>();
  const finalSnapshots = new WeakMap<TransactionReview, DiamondSnapshot>();
  let reservedReview: TransactionReview | null = null;
  // Verification input only: bind the mined hash to this captured review, never whichever plan is open.
  const proofRecord = (review: TransactionReview, hash: Hex): Deployment => {
    const baseline = upgradeBaseline(finalSnapshots.get(review) ?? review.snapshot, target.address);
    if (!baseline.ok) throw new Error(baseline.error);
    return { ...record, pendingUpgrade: { phase: "pending", tx: hash, from: review.from, since: record.at,
      call: { data: review.tx.data, value: review.tx.value.toString() }, baseline: baseline.value,
      desiredRecipeHash: prepared.plan.analysis.recipeHash, catalogHash: prepared.catalog.hash,
      expectedFacets: prepared.plan.expectedFacets, expectedCodehashes: prepared.plan.expectedCodehashes } };
  };
  const current = (): string | null => {
    const context = ports.context();
    return context.key !== contextKey ? "The reviewed upgrade plan changed. Close this review and start Upgrade again."
      : !context.online ? "Upgrade review needs a connection." : context.readOnly;
  };
  const inspect: TransactionDeps["inspect"] = async (chainId, address, signal) => {
    const reservationAtStart = reservedReview;
    const aborted = () => signal.aborted || (reservationAtStart !== null && reservedReview !== reservationAtStart);
    if (chainId !== target.chainId || !sameAddress(address, target.address)) return { ok: false, error: { kind: "invalid", reason: "The upgrade target changed." } };
    try {
      const read = await ports.inspect(target, signal);
      if (aborted()) return { ok: false, error: { kind: "aborted", reason: "The upgrade preflight was canceled." } };
      if (!read.ok) return read;
      const baseline = checkUpgradeBaseline(origin, read.value);
      if (!baseline.ok) return { ok: false, error: { kind: "invalid", reason: baseline.error } };
      const code = await checkUpgradeCode(target, read.value, prepared.requiredCode, ports, signal);
      if (!code.ok) return { ok: false, error: { kind: "invalid", reason: code.error } };
      const catalogs = await ports.catalogs();
      if (aborted()) return { ok: false, error: { kind: "aborted", reason: "The upgrade preflight was canceled." } };
      if (!catalogs.ok) return { ok: false, error: { kind: "invalid", reason: catalogs.error } };
      const authority = await readUpgradeAuthority(target, read.value, catalogs.value, prepared.from, ports.call);
      if (aborted()) return { ok: false, error: { kind: "aborted", reason: "The upgrade preflight was canceled." } };
      if (!authority.ok) return { ok: false, error: { kind: "invalid", reason: authority.error } };
      if (!authority.value.canSign) return { ok: false, error: { kind: "invalid", reason: authority.value.explanation } };
      if (authority.value.identity !== prepared.authority.identity) return { ok: false, error: { kind: "invalid", reason: "The upgrade authority changed. Close this review and start Upgrade again." } };
      if (reservationAtStart !== null) {
        const refreshed = await tracker.refreshBaseline(reservationAtStart, read.value);
        if (aborted()) return { ok: false, error: { kind: "aborted", reason: "The upgrade preflight was canceled." } };
        if (!refreshed.ok) return { ok: false, error: { kind: "invalid", reason: refreshed.error } };
        finalSnapshots.set(reservationAtStart, read.value);
      }
      return read;
    } catch { return { ok: false, error: { kind: "rpc", reason: "The upgrade preflight couldn't finish. Retry its review." } }; }
  };
  const controller = createTransactionController({
    chains: ports.chains,
    chain: async () => {
      const port = await ports.chain();
      return { ...port, simulate: (chainId, request) => {
        if (chainId !== target.chainId || !sameAddress(request.from, prepared.from) || !sameAddress(request.tx.to, target.address)
          || request.tx.data.toLowerCase() !== prepared.tx.data.toLowerCase() || request.tx.value !== prepared.tx.value) {
          return Promise.resolve({ kind: "unavailable" as const, message: "The exact reviewed upgrade transaction changed." });
        }
        return port.simulate(chainId, request);
      } };
    },
    inspect, context: ports.context, subscribe: ports.subscribe, clock: ports.clock, receiptTimeout: ports.receiptTimeout,
    beforeSign: async (review) => {
      const reason = current(); if (reason !== null) return err(reason);
      const reserved = await tracker.reserve(review);
      if (reserved.ok) reservedReview = review;
      return reserved.ok ? ok(undefined) : reserved;
    },
    onUnsent: async (review) => { try { await tracker.unsent(review); } finally { if (reservedReview === review) reservedReview = null; } },
    onSent: async (review, hash) => {
      try {
        const previous = sentHashes.get(review);
        if (previous && previous.toLowerCase() !== hash.toLowerCase()) {
          const cached = sentFacts.get(review)?.get(previous);
          const [before, after] = await Promise.all([cached ? Promise.resolve(ok(cached)) : ports.transaction(target.chainId, previous), ports.transaction(target.chainId, hash)]);
          if (!before.ok || !after.ok || !verifyUpgradeTransaction(proofRecord(review, previous), before.value).ok
            || !verifyUpgradeTransaction(proofRecord(review, hash), after.value).ok || !sameAddress(before.value.from, after.value.from) || before.value.nonce !== after.value.nonce) throw new Error("The repriced hash couldn't be matched to the upgrade's sender, nonce and exact call. Its prior tracking is still saved.");
          const facts = sentFacts.get(review) ?? new Map<Hex, UpgradeObservedTransaction>(); facts.set(hash, after.value); sentFacts.set(review, facts);
        }
        await tracker.sent(review, hash); sentHashes.set(review, hash);
        // Cache the original nonce while a pending transaction is still available; a dropped original
        // might disappear from the RPC once a cancellation is mined. Failure keeps tracking unresolved.
        try {
          const actual = await ports.transaction(target.chainId, hash);
          if (actual.ok && verifyUpgradeTransaction(proofRecord(review, hash), actual.value).ok) {
            const facts = sentFacts.get(review) ?? new Map<Hex, UpgradeObservedTransaction>(); facts.set(hash, actual.value); sentFacts.set(review, facts);
          }
        } catch { /* Receipt verification retries this exact read; no provider text escapes. */ }
      } finally { if (reservedReview === review) reservedReview = null; }
    },
    onReceipt: async (review, receipt) => {
      if (receipt.kind === "aborted") return;
      if (receipt.kind === "replaced") {
        const hash = sentHashes.get(review);
        if (!hash) throw new Error("The original upgrade hash couldn't be authenticated. Its reservation is still saved.");
        const cached = sentFacts.get(review)?.get(hash);
        const original = cached ? ok(cached) : await ports.transaction(target.chainId, hash);
        const [replacement, canonical] = await Promise.all([ports.transaction(target.chainId, receipt.hash), ports.receipt(target.chainId, receipt.hash)]);
        if (!original.ok || !replacement.ok || !canonical.ok) throw new Error("The replacement's canonical sender and nonce couldn't be proved. Its upgrade reservation is still saved.");
        const proof = verifyUpgradeReplacement(proofRecord(review, hash), original.value, replacement.value, canonical.value);
        if (!proof.ok) throw new Error(proof.error);
        await tracker.receipt(review, receipt);
        return;
      }
      const canonical = receipt.kind === "receipt" ? await ports.receipt(target.chainId, receipt.hash) : null;
      if (receipt.kind === "receipt" && (!canonical?.ok || canonical.value.hash.toLowerCase() !== receipt.hash.toLowerCase()
        || canonical.value.block !== receipt.block || canonical.value.status !== receipt.status)) throw new Error("The upgrade receipt couldn't be verified after this attempt's fresh baseline in its canonical block. Its previous revision is still recorded.");
      const actual = await ports.transaction(target.chainId, receipt.hash);
      if (!actual.ok || !canonical?.ok) throw new Error("The mined upgrade transaction couldn't be authenticated. Its previous revision and reservation are still saved.");
      const evidence = verifyUpgradeEvidence(proofRecord(review, receipt.hash), actual.value, canonical.value);
      if (!evidence.ok || evidence.value.status !== receipt.status) throw new Error("The mined transaction doesn't prove the exact reviewed upgrade executed. Its previous revision and reservation are still saved.");
      const outcome = await tracker.receipt(review, receipt);
      if (outcome !== "verify" || receipt.kind !== "receipt") return;
      const read = await ports.inspect(target, new AbortController().signal);
      if (!read.ok) throw new Error(read.error.reason);
      const baseline = upgradeBaseline(read.value, target.address);
      if (!baseline.ok) throw new Error(baseline.error);
      const stillCanonical = await ports.receipt(target.chainId, receipt.hash);
      if (!canonical?.ok || !stillCanonical.ok || stillCanonical.value.hash.toLowerCase() !== receipt.hash.toLowerCase()
        || stillCanonical.value.blockHash.toLowerCase() !== canonical.value.blockHash.toLowerCase()
        || stillCanonical.value.block !== receipt.block || stillCanonical.value.status !== receipt.status) throw new Error("The upgrade receipt changed during verification. Retry observation; its previous revision is still recorded.");
      const settled = await tracker.verified(review, receipt, baseline.value);
      if (!settled.ok) throw new Error(settled.error);
    },
    onSuccess: async () => { await ports.afterSuccess?.(); },
  });
  const intent: TransactionIntent = { chainId: target.chainId, tx: prepared.tx, snapshot: prepared.snapshot, contextKey };
  return {
    controller, intent,
    async beforeSafeExport(safe: Address): Promise<Result<void, string>> {
      const reason = current(); if (reason !== null) return err(reason);
      const read = await ports.inspect(target, new AbortController().signal);
      if (!read.ok) return err(read.error.reason);
      const baseline = checkUpgradeBaseline(origin, read.value); if (!baseline.ok) return baseline;
      const code = await checkUpgradeCode(target, read.value, prepared.requiredCode, ports); if (!code.ok) return code;
      const catalogs = await ports.catalogs(); if (!catalogs.ok) return catalogs;
      const authority = await readUpgradeAuthority(target, read.value, catalogs.value, safe, ports.call);
      if (!authority.ok) return authority;
      if (!authority.value.authenticated || authority.value.kind === "custom" || !authority.value.canSign
        || authority.value.mechanism !== prepared.authority.mechanism) return err("That Safe isn't authenticated as a current executor of this diamond's upgrade mechanism.");
      const account = await safeAccount(safe, read.value, target.chainId, ports); if (!account.ok) return account;
      const init = encodeInit(planInit(prepared.project.recipe, prepared.catalog), prepared.catalog, { self: target.address, deployer: safe });
      if (!init.ok || init.value.data.toLowerCase() !== prepared.details.init.data.toLowerCase() || !sameAddress(init.value.target, prepared.details.init.target)) {
        return err("The initializer depends on the sender. Use explicit intended authority addresses, then review the Safe proposal again.");
      }
      const changed = current(); if (changed !== null) return err(changed);
      const proposal = await tracker.propose(safe, read.value);
      return proposal.ok ? ok(undefined) : proposal;
    },
    async onSafeExport(): Promise<Result<void, string>> { return ok(undefined); },
  };
}
