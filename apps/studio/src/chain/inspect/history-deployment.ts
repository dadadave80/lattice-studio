import { CREATEX, CREATEX_CODEHASH, LATTICE_FACTORY_ABI, isAddress, sameAddress, toChecksum, type Address, type Catalog, type Hex, type PassportCutEvent, type PassportDeployment } from "@lattice-studio/core";
import { decodeEventLog, keccak256, parseAbi } from "viem";
import { getChainId, getCode, getTransaction, getTransactionReceipt } from "viem/actions";
import type { ChainClient } from "../infra/clients";

// Canonical CreateX interface: https://github.com/pcaversaccio/createx/blob/main/src/ICreateX.sol
const CREATION = parseAbi(["event ContractCreation(address indexed newContract, bytes32 indexed salt)", "event ContractCreation(address indexed newContract)"]);

/** Earliest observed cut is not creation proof. Metadata failure leaves provenance unassessed. */
export async function verifyHistoryDeployment(
  client: ChainClient, address: Address, first: PassportCutEvent, blockHash: Hex, catalogs: readonly Catalog[], expectedData: Hex, signal?: AbortSignal,
): Promise<PassportDeployment | null> {
  try {
    if (signal?.aborted) return null;
    if (await getChainId(client) !== client.chain.id) return null;
    if (signal?.aborted) return null;
    const receipt = await getTransactionReceipt(client, { hash: first.txHash });
    if (signal?.aborted) return null;
    if (receipt.status !== "success" || receipt.transactionHash.toLowerCase() !== first.txHash.toLowerCase()
      || receipt.blockNumber !== BigInt(first.block) || receipt.blockHash.toLowerCase() !== blockHash.toLowerCase()
      || !receipt.logs.some((log) => sameAddress(log.address, address) && log.logIndex === first.logIndex && log.data.toLowerCase() === expectedData.toLowerCase())) return null;
    const tx = await getTransaction(client, { hash: first.txHash });
    if (signal?.aborted) return null;
    if (!isAddress(tx.from) || tx.hash.toLowerCase() !== first.txHash.toLowerCase()
      || tx.blockHash?.toLowerCase() !== blockHash.toLowerCase() || tx.blockNumber !== BigInt(first.block)
      || (tx.to !== null && !isAddress(tx.to))) return null;
    let via: PassportDeployment["via"] | null = isAddress(receipt.contractAddress) && tx.to === null && sameAddress(receipt.contractAddress, address) ? "other" : null;
    const factories = catalogs.flatMap((catalog) => [
      { address: catalog.factory.address, codehash: catalog.factory.codehash },
      ...catalog.chains.flatMap((chain) => chain.chainId === client.chain.id && chain.factory ? [{ address: chain.factory.address, codehash: chain.factory.codehash }] : []),
    ]);
    const runtime = new Map<string, Hex | null>();
    const matchesCode = async (target: Address, expected: Hex): Promise<boolean> => {
      if (signal?.aborted) return false;
      const key = target.toLowerCase();
      if (!runtime.has(key)) {
        try {
          const code = await getCode(client, { address: target, blockHash, requireCanonical: true });
          runtime.set(key, code ? keccak256(code) : null);
        } catch { runtime.set(key, null); }
      }
      return !signal?.aborted && runtime.get(key)?.toLowerCase() === expected.toLowerCase();
    };
    for (const log of receipt.logs) {
      if (signal?.aborted) return null;
      if (via !== null) break;
      const factory = factories.find((candidate) => sameAddress(candidate.address, log.address));
      if (factory) {
        try {
          const decoded = decodeEventLog({ abi: LATTICE_FACTORY_ABI, data: log.data, topics: log.topics, strict: true });
          if (decoded.eventName !== "DiamondDeployed" || !sameAddress(decoded.args.diamond, address)) continue;
          if (await matchesCode(factory.address, factory.codehash)) via = "LatticeFactory";
        } catch { /* A log or unavailable archive read cannot establish creation. */ }
      } else if (sameAddress(log.address, CREATEX)) {
        try {
          const decoded = decodeEventLog({ abi: CREATION, data: log.data, topics: log.topics, strict: true });
          if (!sameAddress(decoded.args.newContract, address)) continue;
          if (await matchesCode(CREATEX, CREATEX_CODEHASH)) via = "CreateX";
        } catch { /* Proxy-creation events and unknown runtime code are not proof for this diamond. */ }
      }
    }
    return via === null ? null : { txHash: first.txHash, block: first.block, from: toChecksum(tx.from), to: tx.to === null ? null : toChecksum(tx.to), via };
  } catch { return null; }
}
