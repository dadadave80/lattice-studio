/**
 * ENS (spec L462, contracts `ChainService.resolveEns`): names resolve on Ethereum for mainnets and on Sepolia for
 * testnets, to the address for the selected chain. On the ENS chain itself that's the ETH address (coin type 60);
 * on any other chain it's that chain's ENSIP-11 coin type, `0x80000000 | chainId`. Reverse lookups use the same
 * pairing. viem's Universal Resolver calls do the reading; the name is normalized (ENSIP-15) first, with the
 * normalizer loaded only when a name is resolved.
 */
import type { Address } from "@lattice-studio/core";
import { toChecksum } from "@lattice-studio/core";
import { getEnsAddress, getEnsName } from "viem/actions";
import type { ChainClient } from "./clients";

/** ENSIP-11: coin type 60 on the ENS chain itself, else `0x80000000 | chainId`. */
export function ensCoinType(chainId: number, ensChainId: number): bigint {
  if (chainId === ensChainId) return 60n;
  return (0x80000000n | BigInt(chainId)) & 0xffffffffn;
}

/** ENSIP-15 normalization; throws for an invalid name. Loaded on demand (the normalizer's tables are large). */
export type Normalize = (name: string) => string;

export const loadNormalize = (): Promise<Normalize> => import("viem/ens").then((m) => m.normalize);

/** `name` → the address for `chainId`, or null when the name has none. Throws on an invalid name or RPC failure. */
export async function resolveName(
  client: ChainClient,
  normalize: Normalize,
  name: string,
  chainId: number,
  ensChainId: number,
): Promise<Address | null> {
  const normalized = normalize(name.trim());
  const address = await getEnsAddress(client, { name: normalized, coinType: ensCoinType(chainId, ensChainId) });
  return address ? toChecksum(address) : null;
}

/** `address` → its primary name for `chainId`, or null when none is set. Throws on RPC failure. */
export async function reverseName(client: ChainClient, address: Address, chainId: number, ensChainId: number): Promise<string | null> {
  return (await getEnsName(client, { address, coinType: ensCoinType(chainId, ensChainId) })) ?? null;
}
