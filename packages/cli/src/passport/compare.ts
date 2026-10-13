import type { Address } from "@lattice-studio/core";
import { byCodeUnit } from "./canonical";
import type { LoupeFacet, RoutingDiff } from "./types";

/** The parts of a plan entry the comparison reads; core's `PlanEntry` has them all. */
export type PlanRow = { facet: string; address: Address; selectors: readonly string[] };

const bySelector = (a: { selector: string }, b: { selector: string }): number => byCodeUnit(a.selector, b.selector);

/**
 * Compares a plan with `facets()` selector by selector: missing (the plan routes it, the chain doesn't), extra (the
 * chain routes it, the plan doesn't) and misrouted (both, to different addresses). Order and letter case don't
 * matter: LatticeFactory cuts registry entries before custom cuts, so `facets()` order differs from the plan's.
 */
export function compareRouting(plan: readonly PlanRow[], loupe: readonly LoupeFacet[]): RoutingDiff {
  const expected = new Map<string, { facet: string; address: Address }>();
  for (const entry of plan) for (const selector of entry.selectors) expected.set(selector.toLowerCase(), { facet: entry.facet, address: entry.address });
  const actual = new Map<string, Address>();
  for (const row of loupe) for (const selector of row.selectors) actual.set(selector.toLowerCase(), row.address);
  const diff: RoutingDiff = { missing: [], extra: [], misrouted: [] };
  for (const [selector, want] of expected) {
    const got = actual.get(selector);
    if (got === undefined) diff.missing.push({ selector, facet: want.facet, expected: want.address });
    else if (got.toLowerCase() !== want.address.toLowerCase()) diff.misrouted.push({ selector, facet: want.facet, expected: want.address, actual: got });
  }
  for (const [selector, got] of actual) if (!expected.has(selector)) diff.extra.push({ selector, actual: got });
  diff.missing.sort(bySelector);
  diff.extra.sort(bySelector);
  diff.misrouted.sort(bySelector);
  return diff;
}

export function differenceCount(diff: RoutingDiff): number {
  return diff.missing.length + diff.extra.length + diff.misrouted.length;
}
