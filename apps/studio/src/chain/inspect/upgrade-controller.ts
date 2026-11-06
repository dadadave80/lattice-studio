import { encodeInit, err, isAddress, ok, planInit, sameAddress, type Address, type Deployment, type Result } from "@lattice-studio/core";
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import type { DeployChainPort, DeployClock } from "../deploy/ports";
import { isDelegation } from "../infra/account";
import type { DiamondSnapshot } from "./snapshot";
import { readUpgradeAuthority } from "./upgrade-authority";
import { checkUpgradeBaseline, checkUpgradeCode, upgradeBaseline, type PreparedUpgrade, type UpgradePreflightPorts } from "./upgrade-preflight";
import { createUpgradeRecordTracker, type UpgradeRecordPorts } from "./upgrade-records";
import type { UpgradeObservedReceipt } from "./upgrade-evidence";
import { createTransactionController, type TransactionDeps, type TransactionIntent } from "./transaction";

export type UpgradeExecutionPorts = UpgradePreflightPorts & {
  chains: TransactionDeps["chains"];
  chain(): Promise<DeployChainPort>;
  records: UpgradeRecordPorts;
  context: TransactionDeps["context"];
  subscribe: TransactionDeps["subscribe"];
  clock: DeployClock;
  receiptTimeout(): number;
  receipt(chainId: number, hash: import("@lattice-studio/core").Hex): Promise<Result<UpgradeObservedReceipt, string>>;
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
  const current = (): string | null => {
    const context = ports.context();
    return context.key !== contextKey ? "The reviewed upgrade plan changed. Close this review and start Upgrade again."
      : !context.online ? "Upgrade review needs a connection." : context.readOnly;
  };
  const inspect: TransactionDeps["inspect"] = async (chainId, address, signal) => {
    if (chainId !== target.chainId || !sameAddress(address, target.address)) return { ok: false, error: { kind: "invalid", reason: "The upgrade target changed." } };
    try {
      const read = await ports.inspect(target, signal);
      if (!read.ok) return read;
      const baseline = checkUpgradeBaseline(origin, read.value);
      if (!baseline.ok) return { ok: false, error: { kind: "invalid", reason: baseline.error } };
      const code = await checkUpgradeCode(target, read.value, prepared.requiredCode, ports, signal);
      if (!code.ok) return { ok: false, error: { kind: "invalid", reason: code.error } };
      const catalogs = await ports.catalogs();
      if (!catalogs.ok) return { ok: false, error: { kind: "invalid", reason: catalogs.error } };
      const authority = await readUpgradeAuthority(target, read.value, catalogs.value, prepared.from, ports.call);
      if (!authority.ok) return { ok: false, error: { kind: "invalid", reason: authority.error } };
      if (!authority.value.canSign) return { ok: false, error: { kind: "invalid", reason: authority.value.explanation } };
      if (authority.value.identity !== prepared.authority.identity) return { ok: false, error: { kind: "invalid", reason: "The upgrade authority changed. Close this review and start Upgrade again." } };
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
      return reserved.ok ? ok(undefined) : reserved;
    },
    onUnsent: tracker.unsent,
    onSent: tracker.sent,
    onReceipt: async (review, receipt) => {
      const canonical = receipt.kind === "receipt" ? await ports.receipt(target.chainId, receipt.hash) : null;
      if (receipt.kind === "receipt" && (!canonical?.ok || canonical.value.hash.toLowerCase() !== receipt.hash.toLowerCase()
        || canonical.value.block !== receipt.block || canonical.value.status !== receipt.status || receipt.block <= review.snapshot.block)) throw new Error("The upgrade receipt couldn't be verified after this attempt's fresh baseline in its canonical block. Its previous revision is still recorded.");
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
