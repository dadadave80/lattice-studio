import type { ReactNode } from "react";
import { useOnline, useSession } from "@/contracts";
import { Section } from "../../shared/Section";
import { SpecRows } from "../../shared/SpecRows";
import sheet from "../../shared/sheet.module.css";
import { useChainService, useChains } from "../../shared/use-chain";
import { AvailabilityRow } from "./AvailabilityRow";

/**
 * Availability per chain (IR L122, Flow 3 "Not on the selected chain"): for every chain the chain module
 * lists, whether the facet's release is there as last checked. The chain module loads only once a chain is
 * selected; offline, availability is unknown.
 */
export function AvailabilitySection({ facet }: { facet: string }) {
  const chainId = useSession((s) => s.chainId);
  const online = useOnline();
  const access = useChainService(chainId !== null);
  const chains = useChains(access);

  let body: ReactNode;
  if (!online) body = <p className={sheet.muted}>Offline, availability is unknown.</p>;
  else if (chainId === null) body = <p className={sheet.muted}>Choose a chain to see availability.</p>;
  else if (access.status === "unavailable") body = <p className={sheet.muted}>{access.reason}</p>;
  else if (access.status !== "ready") body = <p className={sheet.muted}>Loading chains…</p>;
  else
    body = (
      <SpecRows>
        {chains.map((chain) => (
          <AvailabilityRow key={chain.id} access={access} chain={chain} facet={facet} />
        ))}
      </SpecRows>
    );

  return <Section label="Availability">{body}</Section>;
}
