import { describe, expect, test } from "bun:test";
import type { Address, Hex, Hex4, PlanEntry } from "@lattice-studio/core";
import { comparePlan } from "@lattice-studio/core";
import { comparisonText, denseSelector, planSize, signatureLookup, verdict } from "./comparison-text";

const A = "0x1111111111111111111111111111111111111111" as Address;
const B = "0x2222222222222222222222222222222222222222" as Address;
const X = "0x3333333333333333333333333333333333333333" as Address;
const DIAMOND = "0x4444444444444444444444444444444444444444" as Address;
const HASH_SHEET = `0x${"ab".repeat(32)}` as Hex;
const HASH_RECORD = `0x${"cd".repeat(32)}` as Hex;

const TRANSFER = "0xa9059cbb" as Hex4;
const APPROVE = "0x095ea7b3" as Hex4;
const PAUSE = "0x8456cb59" as Hex4;
const UNKNOWN = "0xdeadbeef" as Hex4;

const catalog = {
  facets: [
    { selectors: [{ hex: TRANSFER, signature: "transfer(address,uint256)" }, { hex: APPROVE, signature: "approve(address,uint256)" }] },
    { selectors: [{ hex: PAUSE, signature: "pause()" }] },
  ],
} as unknown as Parameters<typeof signatureLookup>[0];
const signatureOf = signatureLookup(catalog);

const entry = (facet: string, address: Address, selectors: Hex4[]): PlanEntry => ({
  facet,
  address,
  codehash: HASH_SHEET,
  version: "0.4.0",
  selectors,
});
const plan = [entry("ERC20", A, [TRANSFER, APPROVE]), entry("Pausable", B, [PAUSE])];

describe("comparison words", () => {
  test("selectors in the dense form, hex alone when the catalog doesn't name it", () => {
    expect(denseSelector(TRANSFER, signatureOf)).toBe("transfer · 0xa9059cbb");
    expect(denseSelector("0xA9059CBB" as Hex4, signatureOf)).toBe("transfer · 0xA9059CBB");
    expect(denseSelector(UNKNOWN, signatureOf)).toBe(UNKNOWN);
  });

  test("the plan's size and the verdict, with plurals (spec L576)", () => {
    expect(planSize(plan)).toBe("the core and 2 facets, 3 selectors");
    expect(planSize([entry("ERC20", A, [TRANSFER])])).toBe("the core and 1 facet, 1 selector");
    // The core's two Adds are named, not counted.
    expect(planSize([entry("DiamondLoupeFacet", A, [TRANSFER]), entry("ERC20", A, [TRANSFER])])).toBe("the core and 1 facet, 2 selectors");
    expect(verdict({ matches: true }, plan)).toBe("Diamond matches the sheet: the core and 2 facets, 3 selectors.");
    expect(verdict({ matches: false }, plan)).toBe("Deployed, but doesn't match the sheet");
  });
});

describe("comparisonText", () => {
  test("a matching diamond: chain, address, both hashes and the verdict", () => {
    const comparison = comparePlan(plan, plan.map((e) => ({ facetAddress: e.address, functionSelectors: e.selectors })));
    const text = comparisonText(
      { chain: "Sepolia", chainId: 11155111, address: DIAMOND, recordHash: HASH_RECORD, sheetHash: HASH_SHEET, plan, comparison },
      signatureOf,
    );
    expect(text).toBe(
      [
        "Compare with the sheet",
        "Chain: Sepolia (11155111)",
        `Address: ${DIAMOND}`,
        `Record's recipe hash: ${HASH_RECORD}`,
        `Sheet's recipe hash: ${HASH_SHEET}`,
        "",
        "Diamond matches the sheet: the core and 2 facets, 3 selectors.",
      ].join("\n"),
    );
  });

  test("every difference: missing per facet, extra per address, moved with both addresses in full", () => {
    // approve is gone, pause moved to X, and X also routes a selector the plan doesn't have.
    const comparison = comparePlan(plan, [
      { facetAddress: A, functionSelectors: [TRANSFER] },
      { facetAddress: X, functionSelectors: [PAUSE, UNKNOWN] },
    ]);
    const text = comparisonText(
      { chain: "Sepolia", chainId: 11155111, address: DIAMOND, recordHash: null, sheetHash: HASH_SHEET, plan, comparison },
      signatureOf,
    );
    expect(text).toContain("Record's recipe hash: No record");
    expect(text).toContain("Deployed, but doesn't match the sheet");
    expect(text).toContain("Missing on chain:\n  ERC20: approve · 0x095ea7b3");
    expect(text).toContain(`Not in the plan:\n  ${X}: ${UNKNOWN}`);
    expect(text).toContain(`Moved:\n  pause · 0x8456cb59: planned at ${B}, on chain at ${X}`);
  });

  test("without a comparison it says why", () => {
    const text = comparisonText(
      {
        chain: "Sepolia",
        chainId: 11155111,
        address: DIAMOND,
        recordHash: null,
        sheetHash: HASH_SHEET,
        plan,
        comparison: null,
        status: "Chain checks need a connection.",
      },
      signatureOf,
    );
    expect(text.split("\n").at(-1)).toBe("Chain checks need a connection.");
  });
});
