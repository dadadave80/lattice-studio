import { describe, expect, test } from "bun:test";
import type { Address } from "../model/hex";
import { loadFixtureCatalog, makeCatalog, makeFacet } from "../testing";
import { buildPassport, compareRouting, differenceCount, identifyFacets, passportFailed, sortCuts, summarizeHistory } from "./index";
import { canonicalJson } from "./canonical";
import type { PassportChainFacts, PassportCutEvent, PassportIdentifiedFacet, PassportRecipeFacts } from "./types";

const A: Address = "0x00000000000000000000000000000000000000aa";
const B: Address = "0x00000000000000000000000000000000000000bb";
const D: Address = "0x00000000000000000000000000000000000000dd";
const TX1 = `0x${"1".repeat(64)}` as const;
const TX2 = `0x${"2".repeat(64)}` as const;
const HASH = `0x${"3".repeat(64)}` as const;
const PIN = { tag: "dev-6c8db45", hash: HASH };

function cut(block: number, logIndex: number, txHash: `0x${string}`): PassportCutEvent {
  return { block, logIndex, txHash, init: A, cuts: [{ facet: A, action: "add", selectors: ["0x12345678"] }] };
}

function facts(over: Partial<PassportChainFacts> = {}): PassportChainFacts {
  return {
    chainId: 10143,
    chainName: "Monad Testnet",
    address: D,
    block: 100,
    hasCode: true,
    loupe: [{ facetAddress: A, functionSelectors: ["0x12345678"] }],
    codehashes: {},
    history: [cut(10, 0, TX1)],
    historySource: "hyperrpc",
    deployment: { txHash: TX1, block: 10, from: B, to: A, via: "LatticeFactory" },
    ownerRouted: true,
    owner: B,
    ...over,
  };
}

const KNOWN: PassportIdentifiedFacet[] = [
  { address: A, codehash: HASH, selectors: ["0x12345678"], kind: "known", name: "ERC20", version: "0.2.0", catalog: "dev-6c8db45" },
];
const UNKNOWN: PassportIdentifiedFacet[] = [
  { address: A, codehash: HASH, selectors: ["0x12345678"], kind: "unknown", name: null, version: null, catalog: null },
];

function recipe(over: Partial<PassportRecipeFacts> = {}): PassportRecipeFacts {
  return { recipeHash: HASH, catalog: PIN, diff: { missing: [], extra: [], misrouted: [] }, selectors: 1, facets: 1, ...over };
}

describe("compareRouting", () => {
  const plan = [{ facet: "ERC20", address: A, selectors: ["0x12345678", "0xAABBCCDD"] }];

  test("matches core loupe rows regardless of order and letter case", () => {
    expect(differenceCount(compareRouting(plan, [{ facetAddress: A, functionSelectors: ["0xaabbccdd", "0x12345678"] }]))).toBe(0);
  });

  test("finds missing, extra and misrouted selectors", () => {
    const diff = compareRouting(plan, [{ facetAddress: B, functionSelectors: ["0x12345678", "0x99999999"] }]);
    expect(diff.missing).toEqual([{ selector: "0xaabbccdd", facet: "ERC20", expected: A }]);
    expect(diff.extra).toEqual([{ selector: "0x99999999", actual: B }]);
    expect(diff.misrouted).toEqual([{ selector: "0x12345678", facet: "ERC20", expected: A, actual: B }]);
    expect(differenceCount(diff)).toBe(3);
  });

  test("sorts differences without mutating plan or loupe", () => {
    const planned = [{ facet: "ERC20", address: A, selectors: ["0xffffffff", "0x11111111"] }];
    const loupe = [{ facetAddress: B, functionSelectors: ["0xbbbbbbbb", "0xaaaaaaaa"] as const }];
    const before = JSON.stringify({ planned, loupe });
    const diff = compareRouting(planned, loupe);
    expect(diff.missing.map((entry) => entry.selector)).toEqual(["0x11111111", "0xffffffff"]);
    expect(diff.extra.map((entry) => entry.selector)).toEqual(["0xaaaaaaaa", "0xbbbbbbbb"]);
    expect(JSON.stringify({ planned, loupe })).toBe(before);
  });
});

describe("summarizeHistory", () => {
  test("no cuts means no deployment", () => {
    expect(summarizeHistory([])).toEqual({ deploymentTx: null, initial: [], later: [] });
  });

  test("groups the earliest transaction's cuts and sorts by block and log without changing input", () => {
    const history = [cut(20, 0, TX2), cut(10, 1, TX1), cut(10, 0, TX1)];
    const before = JSON.stringify(history);
    const summary = summarizeHistory(history);
    expect(summary.deploymentTx).toBe(TX1);
    expect(summary.initial.map((entry) => entry.logIndex)).toEqual([0, 1]);
    expect(summary.later.map((entry) => entry.txHash)).toEqual([TX2]);
    expect(sortCuts(history).map((entry) => [entry.block, entry.logIndex])).toEqual([[10, 0], [10, 1], [20, 0]]);
    expect(JSON.stringify(history)).toBe(before);
  });
});

describe("identifyFacets", () => {
  test("names a fixture release, flags unknown code and marks immutable diamond functions", () => {
    const fixture = loadFixtureCatalog();
    if (!fixture.ok) throw new Error(fixture.error);
    const facet = fixture.value.facets[0];
    if (!facet) throw new Error("The fixture catalog has no facets.");
    const identified = identifyFacets(
      [
        { facetAddress: facet.release.address, functionSelectors: ["0x12345678"] },
        { facetAddress: B, functionSelectors: ["0x87654321"] },
        { facetAddress: D, functionSelectors: ["0x7a0ed627"] },
      ],
      { [facet.release.address.toLowerCase()]: facet.release.codehash, [B]: HASH },
      [fixture.value],
      D,
    );
    expect(identified.map((row) => row.kind)).toEqual(["known", "unknown", "self"]);
    expect(identified[0]).toMatchObject({ name: facet.name, version: facet.release.version, catalog: fixture.value.lattice.tag });
    expect(identified[2]).toMatchObject({ codehash: null, name: null, version: null, catalog: null });
  });

  test("the first matching catalog wins, selectors normalize, and missing code stays unknown", () => {
    const first = makeFacet({ name: "First", selectors: ["first()"] });
    const second = makeFacet({ name: "Second", selectors: ["second()"], release: { ...first.release, version: "9.0.0" } });
    const identified = identifyFacets(
      [{ facetAddress: A, functionSelectors: ["0xAABBCCDD"] }, { facetAddress: B, functionSelectors: [] }],
      { [A]: first.release.codehash.toUpperCase().replace("0X", "0x") as `0x${string}` },
      [makeCatalog({ facets: [first] }), makeCatalog({ facets: [second] })],
      D,
    );
    expect(identified[0]).toMatchObject({ name: "First", version: first.release.version, selectors: ["0xaabbccdd"] });
    expect(identified[1]).toEqual({ address: B, codehash: null, selectors: [], kind: "unknown", name: null, version: null, catalog: null });
  });
});

describe("buildPassport", () => {
  test("matches the fixed CLI passport bytes and digest captured before extraction", async () => {
    const expected = await Bun.file(new URL("./fixtures/cli-passport-v1.json", import.meta.url)).text();
    const passport = buildPassport(facts(), KNOWN, recipe(), PIN);
    expect(`${JSON.stringify(passport, null, 2)}\n`).toBe(expected);
    expect(passport.digest).toBe("0x1519500d19acc847e1ef2f6b9786cdb9427d87f799bba462f7de55d96d0327b8");
  });

  test("all eight claims pass", () => {
    const passport = buildPassport(facts(), KNOWN, recipe(), PIN);
    expect(passport.claims.map((entry) => entry.status)).toEqual(["pass", "pass", "pass", "pass", "pass", "pass", "pass", "pass"]);
    expect(passportFailed(passport)).toBe(false);
  });

  test("an unknown facet fails identity", () => {
    const passport = buildPassport(facts(), UNKNOWN, recipe(), null);
    expect(passport.claims.find((entry) => entry.id === "PP-03")?.status).toBe("fail");
    expect(passportFailed(passport)).toBe(true);
  });

  test("a routing difference fails PP-04", () => {
    const diff = { missing: [{ selector: "0xaabbccdd", facet: "ERC20", expected: A }], extra: [], misrouted: [] };
    const passport = buildPassport(facts(), KNOWN, recipe({ diff }), null);
    expect(passport.claims.find((entry) => entry.id === "PP-04")?.status).toBe("fail");
  });

  test("without a recipe or history the same four CLI claims skip", () => {
    const passport = buildPassport(facts({ history: null, historySource: null, deployment: null }), KNOWN, null, null);
    expect(passport.claims.filter((entry) => entry.status === "skip").map((entry) => entry.id)).toEqual(["PP-04", "PP-05", "PP-06", "PP-07"]);
    expect(passport.claims.find((entry) => entry.id === "PP-04")?.message).toBe("No recipe given: pass --recipe <file> to compare routing.");
    expect(passport.claims.find((entry) => entry.id === "PP-06")?.message).toBe("History not read: set ENVIO_API_TOKEN or pass --from-block.");
  });

  test("missing code and loupe stay failures, with no invented facets", () => {
    const passport = buildPassport(facts({ hasCode: false, loupe: null, ownerRouted: false, owner: null }), [], null, null);
    expect(passport.claims.slice(0, 3).map((entry) => entry.status)).toEqual(["fail", "fail", "skip"]);
    expect(passport.facets).toEqual([]);
    expect(passport.authority).toBeNull();
    expect(passportFailed(passport)).toBe(true);
  });

  test("absent ownership skips and unreadable ownership warns", () => {
    const absent = buildPassport(facts({ ownerRouted: false, owner: null }), KNOWN, null, null);
    const unreadable = buildPassport(facts({ owner: null }), KNOWN, null, null);
    expect(absent.claims.find((entry) => entry.id === "PP-08")?.status).toBe("skip");
    expect(unreadable.claims.find((entry) => entry.id === "PP-08")?.status).toBe("warn");
    expect(passportFailed(unreadable)).toBe(false);
  });

  test("a later cut warns and empty history does not fabricate a deployment", () => {
    const upgraded = buildPassport(facts({ history: [cut(10, 0, TX1), cut(20, 0, TX2)] }), KNOWN, recipe(), null);
    expect(upgraded.claims.find((entry) => entry.id === "PP-06")?.status).toBe("warn");
    const empty = buildPassport(facts({ history: [], deployment: null }), KNOWN, recipe(), null);
    expect(empty.claims.find((entry) => entry.id === "PP-06")?.status).toBe("pass");
    expect(empty.claims.find((entry) => entry.id === "PP-07")?.status).toBe("warn");
    expect(empty.deployment).toBeNull();
  });

  test("the digest is deterministic, responds to facts, and leaves inputs alone", () => {
    const source = facts();
    const before = JSON.stringify({ source, facets: KNOWN });
    const digest = buildPassport(source, KNOWN, recipe(), null).digest;
    expect(buildPassport(source, KNOWN, recipe(), null).digest).toBe(digest);
    expect(buildPassport(facts({ block: 101 }), KNOWN, recipe(), null).digest).not.toBe(digest);
    expect(JSON.stringify({ source, facets: KNOWN })).toBe(before);
  });
});

test("the private serializer retains CLI key ordering, array order and undefined handling", () => {
  expect(canonicalJson({ b: undefined, a: [2, undefined, { d: 3, c: 4 }], Z: null })).toBe('{"Z":null,"a":[2,null,{"c":4,"d":3}]}');
  expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(canonicalJson({ a: [2, { c: 4, d: 3 }], b: 1 }));
});
