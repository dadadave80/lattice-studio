import type { ChainState, Hex } from "@lattice-studio/core";
import { CREATEX_CODEHASH, MULTICALL3_CODEHASH } from "@lattice-studio/core";
import { useCatalog, useDocument } from "@/contracts";
import { SpecRow } from "../../shared/SpecRow";
import { SpecRows } from "../../shared/SpecRows";

/**
 * "present", "missing", or "wrong code" when the address holds a contract whose codehash isn't the expected one
 * (spec L843: Multicall3's deployer key is compromised, so a chain can hold a different contract there).
 */
export function probeWord(probe: { present: boolean; codehash?: Hex } | undefined, expected?: Hex): string {
  if (!probe?.present) return "missing";
  if (expected && probe.codehash && probe.codehash.toLowerCase() !== expected.toLowerCase()) return "wrong code";
  return "present";
}

/** The selected chain's probes as rows (IR L119). */
export function ReadinessRows({ state, name }: { state: ChainState; name: string }) {
  const path = useDocument((s) => s.project.deploy.path);
  const facets = useDocument((s) => s.project.recipe.facets);
  const catalog = useCatalog();
  const present = facets.filter((facet) => state.shared[facet]?.present).length;
  return (
    <SpecRows>
      <SpecRow label="Deployer">{`Arachnid's proxy ${probeWord(state.deployer, catalog?.deployer.codehash)}`}</SpecRow>
      <SpecRow label="Factory">
        {path === "createx"
          ? `CreateX ${probeWord(state.createx, CREATEX_CODEHASH)}`
          : `LatticeFactory ${probeWord(state.shared.LatticeFactory, catalog?.factory.codehash)}`}
      </SpecRow>
      <SpecRow label="Registry">{`LatticeRegistry ${probeWord(state.shared.LatticeRegistry, catalog?.registry.codehash)}`}</SpecRow>
      <SpecRow label="Multicall3">{probeWord(state.multicall3, MULTICALL3_CODEHASH)}</SpecRow>
      <SpecRow label="Facets">{`${present} of ${facets.length} on ${name}`}</SpecRow>
      <SpecRow label="Simulation">{state.simulate ? "eth_simulateV1" : "eth_call only"}</SpecRow>
    </SpecRows>
  );
}
