import { err, isAddress, isHexAnyCase, ok, type Hex, type Result } from "@lattice-studio/core";
import { getBlock, getChainId, getTransaction, getTransactionReceipt } from "viem/actions";
import type { ChainClient } from "../infra/clients";
import type { UpgradeObservedReceipt, UpgradeObservedTransaction } from "./upgrade-evidence";

const hash32 = (value: unknown): value is Hex => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);

/** These readers preserve provider failures as static text and reject a receipt from a noncanonical block. */
export async function readUpgradeTransaction(client: ChainClient, chainId: number, hash: Hex): Promise<Result<UpgradeObservedTransaction, string>> {
  if (!hash32(hash)) return err("Enter a 32-byte transaction hash.");
  try {
    if (client.chain.id !== chainId || await getChainId(client) !== chainId) return err("The transaction RPC serves a different chain.");
    const tx = await getTransaction(client, { hash });
    const block = tx.blockNumber === null ? null : Number(tx.blockNumber);
    if (await getChainId(client) !== chainId || tx.hash.toLowerCase() !== hash.toLowerCase() || !isAddress(tx.from)
      || (tx.to !== null && !isAddress(tx.to)) || !isHexAnyCase(tx.input) || typeof tx.value !== "bigint" || tx.value < 0n || tx.value >= 2n ** 256n
      || !Number.isSafeInteger(tx.nonce) || tx.nonce < 0
      || (block !== null && (!Number.isSafeInteger(block) || block < 0 || !hash32(tx.blockHash))) || (block === null && tx.blockHash !== null)) return err("The RPC returned a malformed upgrade transaction.");
    return ok({ hash: tx.hash, from: tx.from, to: tx.to, data: tx.input, value: tx.value, nonce: tx.nonce, block, blockHash: tx.blockHash });
  } catch { return err("The RPC couldn't read this upgrade transaction. Check its hash and network, then retry observation."); }
}

export async function readUpgradeReceipt(client: ChainClient, chainId: number, hash: Hex): Promise<Result<UpgradeObservedReceipt, string>> {
  if (!hash32(hash)) return err("Enter a 32-byte transaction hash.");
  try {
    if (client.chain.id !== chainId || await getChainId(client) !== chainId) return err("The receipt RPC serves a different chain.");
    const receipt = await getTransactionReceipt(client, { hash });
    const block = Number(receipt.blockNumber);
    if (!Number.isSafeInteger(block) || block < 0 || receipt.transactionHash.toLowerCase() !== hash.toLowerCase() || !hash32(receipt.blockHash)
      || (receipt.status !== "success" && receipt.status !== "reverted")) return err("The RPC returned a malformed upgrade receipt.");
    const canonical = await getBlock(client, { blockNumber: receipt.blockNumber });
    if (canonical.hash?.toLowerCase() !== receipt.blockHash.toLowerCase() || await getChainId(client) !== chainId) return err("The upgrade receipt's block is no longer canonical. Retry observation.");
    const logs = [];
    for (const log of receipt.logs) {
      if (log.removed || !isAddress(log.address) || !isHexAnyCase(log.data) || log.topics.some((topic) => !hash32(topic))
        || log.blockHash?.toLowerCase() !== receipt.blockHash.toLowerCase() || log.transactionHash?.toLowerCase() !== hash.toLowerCase()
        || log.logIndex === null || !Number.isSafeInteger(log.logIndex) || log.logIndex < 0) return err("The upgrade receipt contains malformed or removed events.");
      logs.push({ address: log.address, data: log.data, topics: log.topics, logIndex: log.logIndex });
    }
    return ok({ hash: receipt.transactionHash, status: receipt.status, block, blockHash: receipt.blockHash, logs });
  } catch { return err("The upgrade doesn't have an available canonical receipt. Retry observation after it is mined."); }
}
