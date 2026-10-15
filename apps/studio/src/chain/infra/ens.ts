/**
 * ENS (spec L462, contracts `ChainService.resolveEns`): testnets read Sepolia's ENS, then Ethereum's when Sepolia
 * has no record; Ethereum reads its own. On an ENS chain itself a name's address is its ETH address (coin type 60).
 * On any other chain it's that chain's ENSIP-11 coin type, `0x80000000 | chainId`, then the default EVM address
 * (ENSIP-19, coin type `0x80000000`), then the ETH address. viem passes the coin type straight to the resolver's
 * `addr(node, coinType)` and applies no default itself, so each is asked in turn. Reverse lookups use the same
 * order. viem's Universal Resolver calls do the reading; the name is normalized (ENSIP-15) first, with the
 * normalizer loaded only when a name is resolved.
 */
import type { Address } from "@lattice-studio/core";
import { toChecksum } from "@lattice-studio/core";
import { BaseError } from "viem";
import { getEnsAddress, getEnsName } from "viem/actions";
import type { ChainClient } from "./clients";

/** ENSIP-19's default EVM coin type. */
const DEFAULT_EVM_COIN_TYPE = 0x80000000n;

/** ENSIP-11: coin type 60 on the ENS chain itself, else `0x80000000 | chainId`. */
export function ensCoinType(chainId: number, ensChainId: number): bigint {
  if (chainId === ensChainId) return 60n;
  return (DEFAULT_EVM_COIN_TYPE | BigInt(chainId)) & 0xffffffffn;
}

/** The coin types asked, in order: the chain's own, then (off the ENS chain) the default EVM one and 60. */
export function ensCoinTypes(chainId: number, ensChainId: number): bigint[] {
  if (chainId === ensChainId) return [60n];
  return [ensCoinType(chainId, ensChainId), DEFAULT_EVM_COIN_TYPE, 60n];
}

/** ENSIP-15 normalization; throws for an invalid name. Loaded on demand (the normalizer's tables are large). */
export type Normalize = (name: string) => string;

export const loadNormalize = (): Promise<Normalize> => import("viem/ens").then((m) => m.normalize);

/**
 * `name` → the address for `chainId`, the first record in `ensCoinTypes` order, or null when it has none. Throws
 * on an invalid name or RPC failure.
 */
export async function resolveName(
  client: ChainClient,
  normalize: Normalize,
  name: string,
  chainId: number,
  ensChainId: number,
): Promise<Address | null> {
  const normalized = normalize(name.trim());
  for (const coinType of ensCoinTypes(chainId, ensChainId)) {
    const address = await getEnsAddress(client, { name: normalized, coinType });
    if (address) return toChecksum(address);
  }
  return null;
}

/** `address` → its primary name for `chainId`, in `ensCoinTypes` order, or null when none is set. Throws on RPC failure. */
export async function reverseName(client: ChainClient, address: Address, chainId: number, ensChainId: number): Promise<string | null> {
  for (const coinType of ensCoinTypes(chainId, ensChainId)) {
    const name = await getEnsName(client, { address, coinType });
    if (name) return name;
  }
  return null;
}

/** A CCIP-Read (offchain) lookup failed: the name's gateway didn't answer, not the chain's RPC. */
export function isOffchainLookupFailure(error: unknown): boolean {
  return error instanceof BaseError && error.walk((e) => e instanceof Error && e.name.startsWith("OffchainLookup")) !== null;
}
