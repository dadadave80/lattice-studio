/**
 * The chains the console names and exports for. S8a's chain table (`@/chain/infra`: `pickerChains`,
 * `chainName`) isn't in this work package's base yet, so this is the same data as a local seam: Sepolia and
 * Base Sepolia (spec Phasing: the v1 testnets), plus Anvil in end-to-end builds (contracts §5.5). Swap it for
 * S8a's table once that lands (listed in WP-S5e's report).
 */
import type { Catalog } from "@lattice-studio/core";
import { env } from "@/contracts";

export type ConsoleChain = { id: number; name: string };

const TESTNETS: readonly ConsoleChain[] = [
  { id: 11155111, name: "Sepolia" },
  { id: 84532, name: "Base Sepolia" },
];

const ANVIL: ConsoleChain = { id: 31337, name: "Anvil" };

/** The chains Studio deploys to, in picker order. */
export function studioChains(e2e: boolean = env.e2e): readonly ConsoleChain[] {
  return e2e ? [...TESTNETS, ANVIL] : TESTNETS;
}

/** "Sepolia" for 11155111; "Chain 5" for one Studio doesn't list. */
export function chainName(chainId: number, e2e: boolean = env.e2e): string {
  return studioChains(e2e).find((c) => c.id === chainId)?.name ?? `Chain ${chainId}`;
}

/** A chain as typed: its id, or its name ignoring case and spaces ("sepolia", "base-sepolia", "84532"). */
export function chainFromText(text: string, e2e: boolean = env.e2e): ConsoleChain | undefined {
  const trimmed = text.trim();
  if (/^\d+$/.test(trimmed)) return studioChains(e2e).find((c) => c.id === Number(trimmed));
  const key = trimmed.toLowerCase().replace(/[\s_-]+/g, "");
  return studioChains(e2e).find((c) => c.name.toLowerCase().replace(/\s+/g, "") === key);
}

/**
 * The chains a Foundry script carries constants for: the catalog's release chains, the chains Studio deploys
 * to, and Anvil in end-to-end builds. The catalog lists none today, and `exportFoundry` refuses an empty list,
 * so Studio's own chains are always included (a chain without its own factory uses the canonical one).
 */
export function scriptChainIds(catalog: Pick<Catalog, "chains">, e2e: boolean = env.e2e): number[] {
  const ids = new Set([...catalog.chains.map((c) => c.chainId), ...studioChains(e2e).map((c) => c.id)]);
  return [...ids].sort((a, b) => a - b);
}
