import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { LoupeFacet } from "../model/chain";
import { toChecksum, type Address, type Hex4 } from "../model/hex";
import { addr, checkProperty, sel } from "../testing";
import { buildUpgradeCuts, type UpgradeCut, type UpgradeSelectorLock } from "./cuts";

const A = addr(10);
const B = addr(11);
const C = addr(12);
const D = addr(13);
const ZERO = addr(0);

const row = (facetAddress: Address, selectors: number[]): LoupeFacet => ({ facetAddress, functionSelectors: selectors.map(sel) });
const lock = (facetAddress: Address, selectors: number[], kind: UpgradeSelectorLock["kind"] = "foreign"): UpgradeSelectorLock => ({
  ...row(facetAddress, selectors), kind,
});

function cuts(current: readonly LoupeFacet[], desired: readonly LoupeFacet[], locked: readonly UpgradeSelectorLock[] = []): UpgradeCut[] {
  const result = buildUpgradeCuts({ diamond: D, current, desired, locked });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function refused(current: readonly LoupeFacet[], desired: readonly LoupeFacet[], locked: readonly UpgradeSelectorLock[] = []): string {
  const result = buildUpgradeCuts({ diamond: D, current, desired, locked });
  if (result.ok) throw new Error("Expected the upgrade cut to be refused.");
  return result.error;
}

describe("buildUpgradeCuts", () => {
  test("an exact no-op stays empty without adding any Lattice core selectors", () => {
    expect(cuts([], [])).toEqual([]);
    expect(cuts([row(A, [41])], [row(A, [41])])).toEqual([]);
  });

  test("preserves noncanonical addresses and multiple instances of the same known code", () => {
    const first = addr(0x1234);
    const second = addr(0x5678);
    const current = [row(first, [1, 3]), row(second, [2, 4])];
    expect(cuts(current, [row(second, [4, 2]), row(first, [3, 1])])).toEqual([]);
    expect(cuts(current, [row(second, [4, 2, 3]), row(first, [1])])).toEqual([
      { facetAddress: second, action: 1, functionSelectors: [sel(3)] },
    ]);
  });

  test("emits deterministic Add, Replace and zero-address Remove groups", () => {
    expect(cuts([row(A, [1, 2]), row(B, [3, 4]), row(C, [5])], [row(A, [2, 6]), row(C, [3]), row(B, [7])])).toEqual([
      { facetAddress: A, action: 0, functionSelectors: [sel(6)] },
      { facetAddress: B, action: 0, functionSelectors: [sel(7)] },
      { facetAddress: C, action: 1, functionSelectors: [sel(3)] },
      { facetAddress: ZERO, action: 2, functionSelectors: [sel(1), sel(4), sel(5)] },
    ]);
  });

  test("compares case-insensitively, lowercases selectors and canonicalizes output addresses", () => {
    const address = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const checksum = toChecksum(address);
    expect(cuts(
      [{ facetAddress: address, functionSelectors: ["0xAABBCCDD"] }],
      [{ facetAddress: checksum, functionSelectors: ["0xaabbccdd", "0xFFEEDDCC"] }],
    )).toEqual([{ facetAddress: checksum, action: 0, functionSelectors: ["0xffeeddcc"] }]);
  });

  test("row and selector ordering do not affect cuts, and inputs are not mutated", () => {
    const current = [row(B, [8, 4]), row(A, [7, 1])];
    const desired = [row(C, [4, 2]), row(A, [1, 9])];
    const before = JSON.stringify({ current, desired });
    const actual = cuts(current, desired);
    const reverse = (rows: readonly LoupeFacet[]) => [...rows].reverse().map((entry) => ({
      ...entry, functionSelectors: [...entry.functionSelectors].reverse(),
    }));
    expect(cuts(reverse(current), reverse(desired))).toEqual(actual);
    expect(JSON.stringify({ current, desired })).toBe(before);
  });
});

describe("input validation", () => {
  for (const side of ["current", "desired"] as const) {
    test(`${side}: rejects duplicate addresses even with disjoint selectors`, () => {
      const invalid = [row(A, [1]), row(A, [2])];
      expect(refused(side === "current" ? invalid : [], side === "desired" ? invalid : [])).toContain("more than once");
    });

    test(`${side}: rejects selectors routed twice, including case variants`, () => {
      const invalid: LoupeFacet[] = [
        { facetAddress: A, functionSelectors: ["0xAABBCCDD"] },
        { facetAddress: B, functionSelectors: ["0xaabbccdd"] },
      ];
      expect(refused(side === "current" ? invalid : [], side === "desired" ? invalid : [])).toContain("0xaabbccdd");
    });

    test(`${side}: rejects duplicate selectors on one facet`, () => {
      const invalid = [row(A, [1, 1])];
      expect(refused(side === "current" ? invalid : [], side === "desired" ? invalid : [])).toContain("more than once");
    });

    for (const invalid of [
      null,
      { facetAddress: "0x1234", functionSelectors: [sel(1)] },
      { facetAddress: ZERO, functionSelectors: [sel(1)] },
      { facetAddress: A, functionSelectors: [] },
      { facetAddress: A, functionSelectors: "0x12345678" },
      { facetAddress: A, functionSelectors: ["0x1234"] },
      { facetAddress: A, functionSelectors: [1] },
    ]) {
      test(`${side}: refuses malformed row ${JSON.stringify(invalid)}`, () => {
        const rows = [invalid] as unknown as LoupeFacet[];
        expect(refused(side === "current" ? rows : [], side === "desired" ? rows : [])).not.toBe("");
      });
    }
  }

  test("refuses malformed loupe collections and an invalid or zero diamond", () => {
    for (const current of [null, {}]) {
      expect(buildUpgradeCuts({ diamond: D, current: current as unknown as LoupeFacet[], desired: [], locked: [] }).ok).toBe(false);
    }
    for (const diamond of [ZERO, "0x1234" as Address]) {
      expect(buildUpgradeCuts({ diamond, current: [], desired: [], locked: [] }).ok).toBe(false);
    }
  });
});

describe("immutable diamond selectors", () => {
  const current = [row(D, [1, 2]), row(A, [3])];

  test("can remain unchanged alongside ordinary facet edits", () => {
    expect(cuts(current, [row(D, [2, 1]), row(B, [3])])).toEqual([
      { facetAddress: B, action: 1, functionSelectors: [sel(3)] },
    ]);
  });

  test("cannot be removed, replaced or moved off the diamond", () => {
    for (const desired of [[], [row(D, [1])], [row(D, [1]), row(B, [2])]]) {
      expect(refused(current, desired)).toContain("immutable");
    }
  });

  test("cannot add new self selectors or replace a facet selector with a self selector", () => {
    expect(refused(current, [row(D, [1, 2, 4]), row(A, [3])])).toContain("immutable");
    expect(refused(current, [row(D, [1, 2, 3])])).toContain("immutable");
    expect(refused([], [row(D, [1])])).toContain("immutable");
  });
});

describe("foreign selector groups", () => {
  const current = [row(A, [1, 2]), row(B, [3])];
  const locked = [lock(A, [1, 2])];

  test("retain their complete exact routing or are removed as a whole", () => {
    expect(cuts(current, [row(A, [2, 1]), row(B, [3, 4])], locked)).toEqual([
      { facetAddress: B, action: 0, functionSelectors: [sel(4)] },
    ]);
    expect(cuts(current, [row(B, [3])], locked)).toEqual([
      { facetAddress: ZERO, action: 2, functionSelectors: [sel(1), sel(2)] },
    ]);
  });

  test("cannot be partially removed, extended or reassigned in the same cut", () => {
    for (const desired of [
      [row(A, [1]), row(B, [3])],
      [row(A, [1, 2, 4]), row(B, [3])],
      [row(C, [1, 2]), row(B, [3])],
      [row(B, [1, 3])],
      [row(A, [4]), row(B, [3])],
    ]) {
      expect(refused(current, desired, locked)).toContain("whole");
    }
  });

  test("a foreign policy must name every selector of its current instance", () => {
    expect(refused(current, current, [lock(A, [1])])).toContain("every selector");
  });

  test("rejects policy selectors absent from their claimed baseline instance", () => {
    expect(refused(current, current, [lock(C, [4])])).toContain("current");
    expect(refused(current, current, [lock(A, [3], "extra")])).toContain("current");
    expect(refused(current, current, [lock(A, [1, 2]), lock(A, [1, 2])])).toContain("more than once");
    expect(refused(current, current, [{ ...lock(A, [1, 2]), kind: "unknown" } as unknown as UpgradeSelectorLock])).toContain("kind");
  });
});

describe("locked extra selectors on known instances", () => {
  const current = [row(A, [1, 2, 90]), row(B, [3])];
  const locked = [lock(A, [90], "extra")];

  test("can stay unchanged while known selectors on the instance change", () => {
    expect(cuts(current, [row(A, [2, 4, 90]), row(C, [1]), row(B, [3])], locked)).toEqual([
      { facetAddress: A, action: 0, functionSelectors: [sel(4)] },
      { facetAddress: C, action: 1, functionSelectors: [sel(1)] },
    ]);
  });

  test("can be removed only when the original instance disappears", () => {
    expect(cuts(current, [row(B, [1, 3])], locked)).toEqual([
      { facetAddress: B, action: 1, functionSelectors: [sel(1)] },
      { facetAddress: ZERO, action: 2, functionSelectors: [sel(2), sel(90)] },
    ]);
    expect(refused(current, [row(A, [1, 2]), row(B, [3])], locked)).toContain("whole");
    expect(refused(current, [row(B, [1, 3, 90])], locked)).toContain("whole");
  });
});

test("every generated cut applies legally and yields exactly the desired routing", () => {
  const addresses = [A, B, C];
  const assignments = fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 30 });
  const rows = (owners: number[]): LoupeFacet[] => addresses.flatMap((facetAddress, index) => {
    const functionSelectors = owners.flatMap((owner, selector) => owner === index + 1 ? [sel(selector + 1)] : []);
    return functionSelectors.length ? [{ facetAddress, functionSelectors }] : [];
  });
  const routes = (facets: readonly LoupeFacet[]) => new Map(facets.flatMap((facet) =>
    facet.functionSelectors.map((selector) => [selector, facet.facetAddress] as const)));
  const sort = (map: Map<Hex4, Address>) => [...map].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const outcome = checkProperty("upgrade cuts yield the exact desired routing", fc.property(assignments, assignments, (before, after) => {
    const current = rows(before);
    const desired = rows(after);
    const actual = routes(current);
    for (const cut of cuts(current, desired)) {
      expect(cut.functionSelectors.length).toBeGreaterThan(0);
      for (const selector of cut.functionSelectors) {
        if (cut.action === 0) {
          expect(actual.has(selector)).toBe(false);
          actual.set(selector, cut.facetAddress);
        } else if (cut.action === 1) {
          expect(actual.has(selector)).toBe(true);
          expect(actual.get(selector)).not.toBe(cut.facetAddress);
          actual.set(selector, cut.facetAddress);
        } else {
          expect(cut.facetAddress).toBe(ZERO);
          expect(actual.has(selector)).toBe(true);
          actual.delete(selector);
        }
      }
    }
    expect(sort(actual)).toEqual(sort(routes(desired)));
  }));
  expect(outcome.runs).toBeGreaterThanOrEqual(200);
});
