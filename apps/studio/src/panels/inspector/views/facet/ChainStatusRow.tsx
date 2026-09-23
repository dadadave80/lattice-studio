import type { Facet } from "@lattice-studio/core";
import { useOnline, useSession } from "@/contracts";
import { chainNameOf, useChainService, useChains, useReadiness } from "../../shared/use-chain";
import { SpecRow } from "../../shared/SpecRow";

/**
 * Whether the facet's release is on the selected chain, as the chain module last checked: "Deployed on
 * Sepolia", "Not on Sepolia" or "Not checked yet". Nothing until a chain is selected, so the chain module
 * loads only then.
 */
export function ChainStatusRow({ facet }: { facet: Facet }) {
  const chainId = useSession((s) => s.chainId);
  const online = useOnline();
  const access = useChainService(chainId !== null);
  const chains = useChains(access);
  const readiness = useReadiness(access, chainId);
  if (chainId === null) return null;
  const chain = chainNameOf(chains, chainId);
  let text: string;
  if (!online) text = "Chain checks need a connection.";
  else if (access.status === "unavailable") text = access.reason;
  else if (readiness.status === "ready") text = readiness.state.shared[facet.name]?.present ? `Deployed on ${chain}` : `Not on ${chain}`;
  else text = "Not checked yet";
  return <SpecRow label="Chain">{text}</SpecRow>;
}
