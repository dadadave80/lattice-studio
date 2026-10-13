import { describe, expect, test } from "bun:test";
import { bundledCatalogs } from "../catalogs";
import { buildPassport, failed } from "./build";
import { canonicalJson } from "./canonical";
import { compareRouting, differenceCount } from "./compare";
import { summarizeHistory } from "./history";
import { identifyFacets } from "./identify";
import type { Address } from "@lattice-studio/core";
import type { ChainFacts, CutEvent, IdentifiedFacet, RecipeFacts } from "./types";

const A: Address = "0x00000000000000000000000000000000000000aa";
const B: Address = "0x00000000000000000000000000000000000000bb";
const D: Address = "0x00000000000000000000000000000000000000dd";
const TX1 = `0x${"1".repeat(64)}` as const;
const TX2 = `0x${"2".repeat(64)}` as const;
const HASH = `0x${"3".repeat(64)}` as const;

function cut(block: number, logIndex: number, txHash: `0x${string}`): CutEvent {
  return { block, logIndex, txHash, init: A, cuts: [{ facet: A, action: "add", selectors: ["0x12345678"] }] };
}

function facts(over: Partial<ChainFacts> = {}): ChainFacts {
  return {
    chainId: 10143,
    chainName: "Monad Testnet",
    address: D,
    block: 100,
    hasCode: true,
    loupe: [{ address: A, selectors: ["0x12345678"] }],
    codehashes: {},
    history: [cut(10, 0, TX1)],
    historySource: "hyperrpc",
    deployment: { txHash: TX1, block: 10, from: B, to: A, via: "LatticeFactory" },
    ownerRouted: true,
    owner: B,
    ...over,
  };
}

const KNOWN: IdentifiedFacet[] = [
  { address: A, codehash: HASH, selectors: ["0x12345678"], kind: "known", name: "ERC20", version: "0.2.0", catalog: "dev-6c8db45" },
];
const UNKNOWN: IdentifiedFacet[] = [
  { address: A, codehash: HASH, selectors: ["0x12345678"], kind: "unknown", name: null, version: null, catalog: null },
];

function recipe(over: Partial<RecipeFacts> = {}): RecipeFacts {
  return { recipeHash: HASH, catalog: { tag: "dev-6c8db45", hash: HASH }, diff: { missing: [], extra: [], misrouted: [] }, selectors: 1, facets: 1, ...over };
}

describe("compareRouting", () => {
  const plan = [{ facet: "ERC20", address: A, selectors: ["0x12345678", "0xAABBCCDD"] }];

  test("matches regardless of order and letter case", () => {
    expect(differenceCount(compareRouting(plan, [{ address: A, selectors: ["0xaabbccdd", "0x12345678"] }]))).toBe(0);
  });

  test("finds missing, extra and misrouted selectors", () => {
    const diff = compareRouting(plan, [{ address: B, selectors: ["0x12345678", "0x99999999"] }]);
    expect(diff.missing.map((d) => d.selector)).toEqual(["0xaabbccdd"]);
    expect(diff.extra.map((d) => d.selector)).toEqual(["0x99999999"]);
    expect(diff.misrouted.map((d) => d.selector)).toEqual(["0x12345678"]);
  });
});

describe("summarizeHistory", () => {
  test("no cuts means no deployment", () => {
    expect(summarizeHistory([]).deploymentTx).toBeNull();
  });

  test("the earliest transaction's cuts are the deployment's; later ones are upgrades, in chain order", () => {
    const summary = summarizeHistory([cut(20, 0, TX2), cut(10, 1, TX1), cut(10, 0, TX1)]);
    expect(summary.deploymentTx).toBe(TX1);
    expect(summary.initial.map((c) => c.logIndex)).toEqual([0, 1]);
    expect(summary.later.map((c) => c.txHash)).toEqual([TX2]);
  });
});

describe("identifyFacets", () => {
  test("names a facet by its code hash, flags an unknown one and marks the diamond's own address", () => {
    const set = bundledCatalogs();
    if (!set.ok) throw new Error("No bundled catalog.");
    const catalog = set.value.catalogs[0]?.catalog;
    const facet = catalog?.facets[0];
    if (catalog === undefined || facet === undefined) throw new Error("The bundled catalog has no facets.");
    const rows = identifyFacets(
      [
        { address: facet.release.address, selectors: ["0x12345678"] },
        { address: B, selectors: ["0x87654321"] },
        { address: D, selectors: ["0x7a0ed627"] },
      ],
      { [facet.release.address.toLowerCase()]: facet.release.codehash, [B]: HASH },
      [catalog],
      D,
    );
    expect(rows.map((row) => row.kind)).toEqual(["known", "unknown", "self"]);
    expect(rows[0]?.name).toBe(facet.name);
  });
});

describe("buildPassport", () => {
  test("all eight claims pass", () => {
    const passport = buildPassport(facts(), KNOWN, recipe(), { tag: "dev-6c8db45", hash: HASH });
    expect(passport.claims.map((c) => c.status)).toEqual(["pass", "pass", "pass", "pass", "pass", "pass", "pass", "pass"]);
    expect(failed(passport)).toBe(false);
  });

  test("an unknown facet fails PP-03", () => {
    const passport = buildPassport(facts(), UNKNOWN, recipe(), null);
    expect(passport.claims.find((c) => c.id === "PP-03")?.status).toBe("fail");
    expect(failed(passport)).toBe(true);
  });

  test("a routing difference fails PP-04", () => {
    const diff = { missing: [{ selector: "0xaabbccdd", facet: "ERC20", expected: A }], extra: [], misrouted: [] };
    const passport = buildPassport(facts(), KNOWN, recipe({ diff }), null);
    expect(passport.claims.find((c) => c.id === "PP-04")?.status).toBe("fail");
  });

  test("without a recipe PP-04 and PP-05 skip; without history PP-06 and PP-07 skip", () => {
    const passport = buildPassport(facts({ history: null, historySource: null, deployment: null }), KNOWN, null, null);
    expect(passport.claims.filter((c) => c.status === "skip").map((c) => c.id)).toEqual(["PP-04", "PP-05", "PP-06", "PP-07"]);
  });

  test("a cut after the deployment warns PP-06", () => {
    const passport = buildPassport(facts({ history: [cut(10, 0, TX1), cut(20, 0, TX2)] }), KNOWN, recipe(), null);
    expect(passport.claims.find((c) => c.id === "PP-06")?.status).toBe("warn");
  });

  test("the digest ignores key order and changes with any fact", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
    const digest = buildPassport(facts(), KNOWN, recipe(), null).digest;
    expect(buildPassport(facts(), KNOWN, recipe(), null).digest).toBe(digest);
    expect(buildPassport(facts({ block: 101 }), KNOWN, recipe(), null).digest).not.toBe(digest);
  });
});
