import { describe, expect, test } from "bun:test";
import type { PlanEntry } from "../model/analysis";
import type { LoupeFacet } from "../model/chain";
import { addr, hex, sel } from "../testing";
import { comparePlan } from "./compare";

const A = addr(0xa);
const B = addr(0xb);
const C = addr(0xc);
const D = addr(0xd);

function entry(facet: string, address: typeof A, selectors: number[]): PlanEntry {
  return { facet, address, codehash: hex(1), version: "0.4.0", selectors: selectors.map((n) => sel(n)) };
}

// Catalog order: custom-cut facets (A, B) come before registry facets (C, D) in the plan.
const plan = [entry("Custom1", A, [1, 2, 3]), entry("Custom2", B, [4]), entry("Registry1", C, [5, 6]), entry("Registry2", D, [7])];
const loupe = (address: typeof A, selectors: number[]): LoupeFacet => ({ facetAddress: address, functionSelectors: selectors.map((n) => sel(n)) });

describe("comparePlan", () => {
  test("matches a registry-first facets() ordering, with selectors in any order", () => {
    // LatticeFactory cuts registry entries first, then custom cuts (LatticeFactory.sol:88-101).
    const facets = [loupe(D, [7]), loupe(C, [6, 5]), loupe(A, [3, 1, 2]), loupe(B, [4])];
    expect(comparePlan(plan, facets)).toEqual({ matches: true, missing: [], extra: [], moved: [] });
  });

  test("addresses compare case-insensitively and selectors lowercase", () => {
    const facets = [
      { facetAddress: A.toLowerCase() as typeof A, functionSelectors: [sel(1), sel(2), sel(3)] },
      { facetAddress: B.toUpperCase().replace("0X", "0x") as typeof B, functionSelectors: [sel(4)] },
      loupe(C, [5, 6]),
      loupe(D, [7]),
    ];
    expect(comparePlan(plan, facets).matches).toBe(true);
  });

  test("reports missing selectors per planned facet", () => {
    const facets = [loupe(C, [5]), loupe(A, [1, 2, 3]), loupe(B, [4])];
    expect(comparePlan(plan, facets)).toEqual({
      matches: false,
      missing: [
        { facet: "Registry1", selectors: [sel(6)] },
        { facet: "Registry2", selectors: [sel(7)] },
      ],
      extra: [],
      moved: [],
    });
  });

  test("reports extra selectors per diamond facet address, including unknown addresses", () => {
    const stranger = addr(0xeeee);
    const facets = [loupe(D, [7]), loupe(C, [5, 6, 9]), loupe(stranger, [10, 11]), loupe(A, [1, 2, 3]), loupe(B, [4])];
    expect(comparePlan(plan, facets)).toEqual({
      matches: false,
      missing: [],
      extra: [
        { address: C, selectors: [sel(9)] },
        { address: stranger, selectors: [sel(10), sel(11)] },
      ],
      moved: [],
    });
  });

  test("reports selectors routed to a different address than planned as moved", () => {
    // An older transaction with the same sender and salt landed first: 0x…03 sits on an old facet.
    const old = addr(0x01d);
    const facets = [loupe(D, [7]), loupe(C, [5, 6]), loupe(A, [1, 2]), loupe(old, [3]), loupe(B, [4])];
    expect(comparePlan(plan, facets)).toEqual({
      matches: false,
      missing: [],
      extra: [],
      moved: [{ selector: sel(3), expected: A, actual: old }],
    });
  });

  test("an empty diamond misses every planned selector", () => {
    const result = comparePlan(plan, []);
    expect(result.matches).toBe(false);
    expect(result.missing.map((m) => m.facet)).toEqual(["Custom1", "Custom2", "Registry1", "Registry2"]);
    expect(result.missing.flatMap((m) => m.selectors)).toHaveLength(7);
  });

  test("an empty plan against an empty diamond matches", () => {
    expect(comparePlan([], [])).toEqual({ matches: true, missing: [], extra: [], moved: [] });
  });
});
