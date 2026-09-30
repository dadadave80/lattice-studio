import type { Analysis, PlanEntry } from "./analysis";
import type { Hex4 } from "./hex";

/** The facets in every recipe beside the proxy's fallback: never on the sheet, first in the cut plan. */
export const CORE_FACETS = ["DiamondLoupeFacet", "ERC165Facet"] as const;
export type CoreFacet = (typeof CORE_FACETS)[number];

/** The diamond's fixed part, as the core cell, the Diamond view and the console's `core` verb read it. */
export type CoreStatus = {
  /** The recipe's counts, the core's own five selectors included: an empty sheet reads "5 routed". */
  fallback: Analysis["stats"];
  /** The four loupe selectors in LatticeFactory's order, and the ones that route. */
  loupe: { selectors: Hex4[]; covered: Hex4[] };
  /** `covered`: supportsInterface routes. `interfaceIds`: what the init registers, IERC165 first. */
  erc165: { covered: boolean; interfaceIds: { id: Hex4; name: string }[] };
  /** The placed cut facet (family "upgrade"); `conflict` when two are placed; `immutable` when the recipe says so. */
  cut: { facet: string | null; conflict: boolean; immutable: boolean };
  /** Init step names in call order, the automatic introspection step included. */
  init: string[];
  /** The cut plan: the core's entries, then the rest. */
  plan: { fixed: PlanEntry[]; rest: PlanEntry[] };
};
