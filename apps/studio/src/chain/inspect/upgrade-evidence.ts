import { err, isAddress, isHexAnyCase, ok, sameAddress, type Address, type Deployment, type Hex, type Result, type UpgradeReceipt } from "@lattice-studio/core";
import { decodeEventLog, decodeFunctionData, encodeFunctionData, parseAbi } from "viem";
import { decodeDiamondCutLog } from "./history-codec";
import { UPGRADE_ABI } from "./upgrade-preflight";

export const SAFE_EXEC_ABI = parseAbi(["function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns(bool)"]);
const SAFE_FAILURE_ABI = parseAbi(["event ExecutionFailure(bytes32 txHash,uint256 payment)"]);

export type UpgradeObservedTransaction = { hash: Hex; from: Address; to: Address | null; data: Hex; value: bigint; nonce: number; block?: number | null; blockHash?: Hex | null };
export type UpgradeObservedLog = { address: Address; data: Hex; topics: readonly Hex[]; logIndex: number };
export type UpgradeObservedReceipt = UpgradeReceipt & { blockHash: Hex; logs: readonly UpgradeObservedLog[] };

const hash32 = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
function validTransaction(tx: UpgradeObservedTransaction): boolean {
  return hash32(tx.hash) && isAddress(tx.from) && (tx.to === null || isAddress(tx.to)) && isHexAnyCase(tx.data)
    && typeof tx.value === "bigint" && tx.value >= 0n && tx.value < 2n ** 256n && Number.isSafeInteger(tx.nonce) && tx.nonce >= 0;
}

/** Exact direct transaction or single Safe Call envelope. No caller/name/ABI is inferred from a label. */
export function verifyUpgradeTransaction(record: Deployment, tx: UpgradeObservedTransaction): Result<"direct" | "safe", string> {
  const pending = record.pendingUpgrade;
  const call = pending?.call;
  if (!pending || !call) return err("The saved upgrade has no exact transaction intent. Its hash can't be attached automatically.");
  if (!validTransaction(tx)) return err("The RPC returned a malformed upgrade transaction.");
  if (pending.tx !== undefined && pending.tx.toLowerCase() !== tx.hash.toLowerCase()) return err("A different transaction hash is already being tracked for this upgrade.");
  if (tx.to !== null && sameAddress(tx.to, record.address) && sameAddress(tx.from, pending.from)
    && tx.data.toLowerCase() === call.data.toLowerCase() && tx.value.toString() === call.value) return ok("direct");
  if (tx.to !== null && sameAddress(tx.to, pending.from)) {
    try {
      const decoded = decodeFunctionData({ abi: SAFE_EXEC_ABI, data: tx.data });
      const [to, value, data, operation] = decoded.args;
      if (operation === 0 && sameAddress(to, record.address) && value.toString() === call.value && data.toLowerCase() === call.data.toLowerCase()) return ok("safe");
    } catch { /* An arbitrary router envelope can't establish the saved caller. */ }
  }
  return err("This transaction doesn't match the saved diamond caller, value and exact calldata.");
}

/** A canonical same-sender/nonce call consumes the intended transaction's nonce without executing it. */
export function verifyUpgradeReplacement(record: Deployment, original: UpgradeObservedTransaction, replacement: UpgradeObservedTransaction, receipt: UpgradeObservedReceipt): Result<void, string> {
  if (!verifyUpgradeTransaction(record, original).ok || !validTransaction(replacement) || original.hash.toLowerCase() === replacement.hash.toLowerCase()
    || !sameAddress(original.from, replacement.from) || original.nonce !== replacement.nonce) return err("The replacement doesn't prove the intended upgrade's sender and nonce were consumed.");
  if (!hash32(receipt.hash) || !hash32(receipt.blockHash) || receipt.hash.toLowerCase() !== replacement.hash.toLowerCase()
    || !Number.isSafeInteger(receipt.block) || !record.pendingUpgrade || receipt.block <= record.pendingUpgrade.baseline.block
    || (receipt.status !== "success" && receipt.status !== "reverted") || replacement.block !== receipt.block
    || replacement.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase()) return err("The replacement needs an available canonical receipt after this upgrade's baseline.");
  const rebound = { ...record, pendingUpgrade: { ...record.pendingUpgrade, tx: replacement.hash } };
  if (verifyUpgradeTransaction(rebound, replacement).ok) return err("The replacement still contains the intended upgrade call and may have executed it. Its reservation must remain unresolved.");
  return ok(undefined);
}

function matchingCut(log: UpgradeObservedLog, record: Deployment): boolean {
  const decoded = decodeDiamondCutLog(log, record.address);
  if (!decoded.ok || !record.pendingUpgrade?.call) return false;
  try {
    return encodeFunctionData({ abi: UPGRADE_ABI, functionName: "diamondCut", args: [decoded.value.cuts, decoded.value.init, decoded.value.data] }).toLowerCase() === record.pendingUpgrade.call.data.toLowerCase();
  } catch { return false; }
}

/** Receipt proof after the transport has verified its canonical block. */
export function verifyUpgradeEvidence(record: Deployment, tx: UpgradeObservedTransaction, receipt: UpgradeObservedReceipt): Result<UpgradeReceipt, string> {
  if (!validTransaction(tx) || !hash32(receipt.hash) || !hash32(receipt.blockHash) || receipt.hash.toLowerCase() !== tx.hash.toLowerCase()
    || (receipt.status !== "success" && receipt.status !== "reverted") || !Number.isSafeInteger(receipt.block) || receipt.block < 0) return err("The upgrade transaction and receipt don't identify one mined call.");
  if (!record.pendingUpgrade || receipt.block <= record.pendingUpgrade.baseline.block) return err("The upgrade receipt must come after this attempt's fresh baseline. An older identical call can't verify this upgrade.");
  if ((tx.block !== undefined && tx.block !== receipt.block) || (tx.blockHash !== undefined && tx.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase())) return err("The upgrade transaction and receipt identify different mined blocks.");
  if (record.pendingUpgrade?.tx !== undefined && record.pendingUpgrade.tx.toLowerCase() !== tx.hash.toLowerCase()) return err("A different transaction hash is already being tracked for this upgrade.");
  const direct = verifyUpgradeTransaction(record, tx);
  if (receipt.status === "reverted") return direct.ok ? ok({ hash: receipt.hash, status: "reverted", block: receipt.block }) : direct;
  if (direct.ok && direct.value === "direct") return ok({ hash: receipt.hash, status: "success", block: receipt.block });
  const logs = [...receipt.logs].sort((a, b) => a.logIndex - b.logIndex);
  if (logs.some((log) => !Number.isSafeInteger(log.logIndex) || log.logIndex < 0 || !isAddress(log.address) || !isHexAnyCase(log.data) || log.topics.some((topic) => !hash32(topic)))
    || new Set(logs.map((log) => log.logIndex)).size !== logs.length) return err("The receipt's events are malformed or duplicated.");
  const matches = logs.flatMap((log, index) => matchingCut(log, record) ? [index] : []);
  if (direct.ok && direct.value === "safe" && matches.length > 0) return ok({ hash: receipt.hash, status: "success", block: receipt.block });
  if (direct.ok && direct.value === "safe") {
    const failed = logs.some((log) => {
      if (!record.pendingUpgrade || !sameAddress(log.address, record.pendingUpgrade.from)) return false;
      try { return decodeEventLog({ abi: SAFE_FAILURE_ABI, topics: [...log.topics] as [Hex, ...Hex[]], data: log.data, strict: true }).eventName === "ExecutionFailure"; }
      catch { return false; }
    });
    if (failed) return ok({ hash: receipt.hash, status: "reverted", block: receipt.block });
  }
  return err("The receipt doesn't prove the saved upgrade executed from its intended caller. The previous revision is still recorded.");
}
