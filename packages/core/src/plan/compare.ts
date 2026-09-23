import type { PlanComparison } from "../model/analysis";
import type { ComparePlanFn } from "../model/api";
import { toChecksum, toLowerHex, type Address, type Hex4 } from "../model/hex";

/**
 * The plan against a diamond's `facets()`, per facet as sets (contracts §3.1). Order never matters, at either
 * level: LatticeFactory cuts registry entries before custom cuts (`LatticeFactory.sol:88-101`), so `facets()`
 * lists facets in a different order from the plan, and selectors within a facet may come back in any order.
 *
 * - `missing`: planned selectors the diamond doesn't route at all, per planned facet, in plan order.
 * - `extra`: selectors the diamond routes that the plan doesn't have, per diamond facet address, in `facets()` order.
 * - `moved`: selectors both have, routed to a different address than planned, in plan order.
 *
 * Selectors compare lowercase and addresses case-insensitively; addresses come back checksummed.
 */
export const comparePlan: ComparePlanFn = (plan, facets) => {
  const expected = new Map<Hex4, Address>();
  for (const entry of plan) {
    for (const selector of entry.selectors) {
      const hex = toLowerHex(selector);
      if (!expected.has(hex)) expected.set(hex, entry.address);
    }
  }
  const actual = new Map<Hex4, Address>();
  for (const facet of facets) {
    for (const selector of facet.functionSelectors) {
      const hex = toLowerHex(selector);
      if (!actual.has(hex)) actual.set(hex, facet.facetAddress);
    }
  }

  const missing: PlanComparison["missing"] = [];
  const moved: PlanComparison["moved"] = [];
  const seen = new Set<Hex4>();
  for (const entry of plan) {
    const absent: Hex4[] = [];
    for (const selector of entry.selectors) {
      const hex = toLowerHex(selector);
      if (seen.has(hex)) continue;
      seen.add(hex);
      const at = actual.get(hex);
      if (at === undefined) absent.push(hex);
      else if (at.toLowerCase() !== entry.address.toLowerCase()) {
        moved.push({ selector: hex, expected: toChecksum(entry.address), actual: toChecksum(at) });
      }
    }
    if (absent.length > 0) missing.push({ facet: entry.facet, selectors: absent });
  }

  const extra: PlanComparison["extra"] = [];
  for (const facet of facets) {
    const unplanned = facet.functionSelectors.map(toLowerHex).filter((hex) => !expected.has(hex));
    if (unplanned.length === 0) continue;
    const address = toChecksum(facet.facetAddress);
    const group = extra.find((e) => e.address === address);
    if (group) group.selectors.push(...unplanned.filter((hex) => !group.selectors.includes(hex)));
    else extra.push({ address, selectors: [...new Set(unplanned)] });
  }

  return { matches: missing.length === 0 && extra.length === 0 && moved.length === 0, missing, extra, moved };
};
