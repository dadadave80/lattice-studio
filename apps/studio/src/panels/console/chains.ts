/**
 * The chains a Foundry script carries constants for: the catalog's release chains plus the chains Studio deploys
 * to (S8a's picker list, which includes Anvil in end-to-end builds). The catalog lists none today and
 * `exportFoundry` refuses an empty list, so Studio's own chains are always included; a chain without its own
 * factory uses the canonical one. S8a's table is plain data: reading it never loads the lazy chain runtime.
 */
import type { Catalog } from "@lattice-studio/core";
import { pickerChains } from "@/chain/infra/chains";
import { env } from "@/contracts";

export function scriptChainIds(catalog: Pick<Catalog, "chains">, e2e: boolean = env.e2e): number[] {
  const ids = new Set([...catalog.chains.map((c) => c.chainId), ...pickerChains(e2e).map((c) => c.id)]);
  return [...ids].sort((a, b) => a - b);
}
