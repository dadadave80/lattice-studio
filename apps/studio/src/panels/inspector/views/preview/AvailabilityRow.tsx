import type { ChainInfo } from "@/contracts";
import type { ChainAccess } from "../../shared/use-chain";
import { useReadiness } from "../../shared/use-chain";
import { SpecRow } from "../../shared/SpecRow";

/** One chain's availability for a facet: "Available", "Not on Base Sepolia" or "Not checked yet". */
export function AvailabilityRow({ access, chain, facet }: { access: ChainAccess; chain: ChainInfo; facet: string }) {
  const readiness = useReadiness(access, chain.id);
  let text = "Not checked yet";
  if (readiness.status === "ready") text = readiness.state.shared[facet]?.present ? "Available" : `Not on ${chain.name}`;
  return (
    <SpecRow label={chain.name}>
      <span data-chain={chain.id}>{text}</span>
    </SpecRow>
  );
}
