import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Hex4 } from "../model/hex";
import { makeCatalog, makeFacet, makeRecipe } from "../testing";
import { computeRouting } from "./routing";
import { catalog, fixture, S, template } from "./test-support";

const GOLDEN = new URL("../../../../golden/expected/", import.meta.url);

type Golden = { recipe: string; routing: Record<Hex4, string> };

function golden(name: string): Golden {
  return JSON.parse(readFileSync(new URL(`${name}.routing.json`, GOLDEN), "utf8")) as Golden;
}

describe("computeRouting against Lattice's deploy scripts (golden/expected)", () => {
  test.skipIf(fixture === null).each([
    ["GovernedVault", 120],
    ["ERC20", 15],
    ["SafeDiamondCut", 29],
  ])("%s routes exactly what its script cuts (%i selectors)", (name, count) => {
    const expected = golden(name).routing;
    const routing = computeRouting(template(name), catalog());
    const owned = Object.fromEntries(
      Object.entries(routing).flatMap(([selector, route]) => (route.owner === undefined ? [] : [[selector, route.owner]])),
    );
    expect(owned).toEqual(expected);
    expect(Object.keys(owned).length).toBe(count);
  });

  test.skipIf(fixture === null)("GovernedVault: seams, defaults and the template's owners (R19, DeployGovernedVault.s.sol:116-167)", () => {
    const routing = computeRouting(template("GovernedVault"), catalog());
    const route = (s: Hex4) => [routing[s]?.owner, routing[s]?.via];
    for (const s of [S.transfer, S.transferFrom, S.deposit, S.mint, S.withdraw, S.redeem, S.castVoteBySig]) {
      expect([s, ...route(s)]).toEqual([s, "GovernedVault", "seam"]);
    }
    expect(route(S.totalAssets)).toEqual(["VaultCore", "seam"]);
    expect(route(S.decimals)).toEqual(["ERC4626", "seam"]);
    expect(route(S.delegate)).toEqual(["ERC20Votes", "seam"]);
    expect(route(S.delegateBySig)).toEqual(["ERC20Votes", "seam"]);
    for (const s of [S.name, S.clock, S.CLOCK_MODE]) expect([s, ...route(s)]).toEqual([s, "GovernedVault", "chosen"]);
    expect(route(S.receive)).toEqual(["Receive", "only"]);
    expect(routing[S.transfer]?.contenders).toEqual(["ERC20", "ERC20Votes", "GovernedVault"]);
  });

  test.skipIf(fixture === null)("without the template's owners, name, clock and CLOCK_MODE go to GovernedVault by default", () => {
    const recipe = template("GovernedVault");
    recipe.owners = {};
    const routing = computeRouting(recipe, catalog());
    for (const s of [S.name, S.clock, S.CLOCK_MODE]) expect([s, routing[s]?.owner, routing[s]?.via]).toEqual([s, "GovernedVault", "default"]);
    expect([routing[S.transfer]?.owner, routing[S.transfer]?.via]).toEqual(["GovernedVault", "seam"]);
  });

  test.skipIf(fixture === null)("Axelar + Hyperlane: both shared selectors are unresolved until owners are set", () => {
    const facets = ["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"];
    const open = computeRouting(makeRecipe({ facets }, catalog()), catalog());
    expect(open[S.sendMessage]).toEqual({ contenders: facets, via: "chosen" });
    expect(open[S.supportsAttribute]).toEqual({ contenders: facets, via: "chosen" });
    const owners = { [S.sendMessage]: "HyperlaneGatewayAdapter", [S.supportsAttribute]: "AxelarGatewayAdapter" };
    const chosen = computeRouting(makeRecipe({ facets, owners }, catalog()), catalog());
    expect(chosen[S.sendMessage]).toEqual({ owner: "HyperlaneGatewayAdapter", contenders: facets, via: "chosen" });
    expect(chosen[S.supportsAttribute]).toEqual({ owner: "AxelarGatewayAdapter", contenders: facets, via: "chosen" });
  });
});

// A small catalog for the resolution rules, one at a time.
const A = makeFacet({ name: "A", selectors: ["shared()", "onlyA()", "exportSelectors()"] });
const B = makeFacet({ name: "B", selectors: ["shared()", "tie()", "seamed()"] });
const C = makeFacet({ name: "C", selectors: ["shared()", "tie()", "seamed()"], defaultOwnerOf: [] });
const D = makeFacet({ name: "D", selectors: ["seamed()", "picked()"] });
const E = makeFacet({ name: "E", selectors: ["picked()"] });
const small = makeCatalog({
  facets: [A, B, C, D, E],
  seams: [{ selector: sig(B, "seamed()"), when: ["D"], anyOf: ["C", "B"], reason: "keeps state in step" }],
});

function sig(facet: { selectors: { hex: Hex4; signature: string }[] }, signature: string): Hex4 {
  const found = facet.selectors.find((s) => s.signature === signature);
  if (found === undefined) throw new Error(signature);
  return found.hex;
}

const shared = sig(A, "shared()");
const onlyA = sig(A, "onlyA()");
const tie = sig(B, "tie()");
const seamed = sig(B, "seamed()");
const picked = sig(D, "picked()");

describe("computeRouting resolution order", () => {
  test("every exported selector once, keys sorted, contenders in catalog order whatever the recipe's order", () => {
    const routing = computeRouting(makeRecipe({ facets: ["C", "A", "B"] }), small);
    expect(Object.keys(routing)).toEqual(Object.keys(routing).sort());
    expect(routing[shared]?.contenders).toEqual(["A", "B", "C"]);
    expect(routing).toEqual(computeRouting(makeRecipe({ facets: ["A", "B", "C"] }), small));
  });

  test("exportSelectors() 0x0ef22643 is never routed", () => {
    expect(A.selectors.map((s) => s.hex)).toContain(S.exportSelectors);
    expect(computeRouting(makeRecipe({ facets: ["A"] }), small)[S.exportSelectors]).toBeUndefined();
  });

  test("an excluded selector stays listed with its contenders but no owner, even when a seam or an owner would serve it", () => {
    const recipe = makeRecipe({ facets: ["A", "B", "D"], exclude: [shared, seamed], owners: { [shared]: "B" } });
    const routing = computeRouting(recipe, small);
    expect(routing[shared]).toEqual({ contenders: ["A", "B"], via: "chosen" });
    expect(routing[seamed]).toEqual({ contenders: ["B", "D"], via: "chosen" });
    expect(routing[onlyA]).toEqual({ owner: "A", contenders: ["A"], via: "only" });
  });

  test("a placed facet whose selectors are all excluded still appears through routing's contenders", () => {
    const routing = computeRouting(makeRecipe({ facets: ["E"], exclude: [picked] }), small);
    expect(routing).toEqual({ [picked]: { contenders: ["E"], via: "chosen" } });
    const all = computeRouting(makeRecipe({ facets: ["A", "B", "C", "D", "E"], exclude: [picked, seamed, shared, tie, onlyA] }), small);
    const listed = new Set(Object.values(all).flatMap((route) => route.contenders));
    expect([...listed].sort()).toEqual(["A", "B", "C", "D", "E"]);
    expect(Object.values(all).every((route) => route.owner === undefined)).toBe(true);
  });

  test("a single contender owns it: via only", () => {
    expect(computeRouting(makeRecipe({ facets: ["A"] }), small)[shared]).toEqual({ owner: "A", contenders: ["A"], via: "only" });
  });

  test("an explicit owner among the contenders: via chosen; owner keys match in any letter case", () => {
    const upper = shared.toUpperCase().replace("0X", "0x") as Hex4;
    const routing = computeRouting(makeRecipe({ facets: ["A", "B"], owners: { [upper]: "B" } }), small);
    expect(routing[shared]).toEqual({ owner: "B", contenders: ["A", "B"], via: "chosen" });
  });

  test("an owner that isn't a contender doesn't route (SEL-05 reports it)", () => {
    const routing = computeRouting(makeRecipe({ facets: ["A", "B"], owners: { [shared]: "C" } }), small);
    expect(routing[shared]).toEqual({ contenders: ["A", "B"], via: "chosen" });
  });

  test("exactly one contender listing it in defaultOwnerOf: via default; two defaults leave it unresolved", () => {
    const withDefault = makeCatalog({ facets: [A, { ...B, defaultOwnerOf: [shared] }, C] });
    expect(computeRouting(makeRecipe({ facets: ["A", "B", "C"] }), withDefault)[shared]).toEqual({
      owner: "B",
      contenders: ["A", "B", "C"],
      via: "default",
    });
    const twoDefaults = makeCatalog({ facets: [A, { ...B, defaultOwnerOf: [shared] }, { ...C, defaultOwnerOf: [shared] }] });
    expect(computeRouting(makeRecipe({ facets: ["A", "B", "C"] }), twoDefaults)[shared]).toEqual({ contenders: ["A", "B", "C"], via: "chosen" });
  });

  test("an explicit owner beats a default", () => {
    const withDefault = makeCatalog({ facets: [A, { ...B, defaultOwnerOf: [shared] }] });
    const routing = computeRouting(makeRecipe({ facets: ["A", "B"], owners: { [shared]: "A" } }), withDefault);
    expect(routing[shared]).toEqual({ owner: "A", contenders: ["A", "B"], via: "chosen" });
  });

  test("unresolved: contenders listed, no owner key", () => {
    const route = computeRouting(makeRecipe({ facets: ["B", "C"] }), small)[tie];
    expect(route).toEqual({ contenders: ["B", "C"], via: "chosen" });
    expect(route !== undefined && "owner" in route).toBe(false);
  });

  test("an active seam routes to the first placed facet in anyOf, before only, chosen and default", () => {
    const routing = computeRouting(makeRecipe({ facets: ["B", "C", "D"] }), small);
    expect(routing[seamed]).toEqual({ owner: "C", contenders: ["B", "C", "D"], via: "seam" });
    const onlyB = computeRouting(makeRecipe({ facets: ["B", "D"] }), small);
    expect(onlyB[seamed]).toEqual({ owner: "B", contenders: ["B", "D"], via: "seam" });
  });

  test("a seam routes even a selector with one contender", () => {
    const seamOnly = makeCatalog({
      facets: [B, D],
      seams: [{ selector: picked, when: ["D"], anyOf: ["D"], reason: "r" }],
    });
    expect(computeRouting(makeRecipe({ facets: ["D"] }), seamOnly)[picked]).toEqual({ owner: "D", contenders: ["D"], via: "seam" });
  });

  test("no owner moves a seam off the first placed facet in anyOf: outside anyOf (SEM-01 anchors it) or another allowed facet", () => {
    const outside = computeRouting(makeRecipe({ facets: ["B", "C", "D"], owners: { [seamed]: "D" } }), small);
    expect(outside[seamed]).toEqual({ owner: "C", contenders: ["B", "C", "D"], via: "seam" });
    const allowed = computeRouting(makeRecipe({ facets: ["B", "C", "D"], owners: { [seamed]: "B" } }), small);
    expect(allowed[seamed]).toEqual({ owner: "C", contenders: ["B", "C", "D"], via: "seam" });
  });

  test("a seam isn't active until every facet in when is placed", () => {
    const routing = computeRouting(makeRecipe({ facets: ["B", "C"] }), small);
    expect(routing[seamed]).toEqual({ contenders: ["B", "C"], via: "chosen" });
  });

  test("an active seam with none of anyOf placed falls through to the other rules", () => {
    const routing = computeRouting(makeRecipe({ facets: ["D"] }), small);
    expect(routing[seamed]).toEqual({ owner: "D", contenders: ["D"], via: "only" });
    const unserved = makeCatalog({ facets: [C, D, E], seams: [{ selector: picked, when: ["D"], anyOf: ["C"], reason: "r" }] });
    const two = computeRouting(makeRecipe({ facets: ["C", "D", "E"], owners: { [picked]: "E" } }), unserved);
    expect(two[picked]).toEqual({ owner: "E", contenders: ["D", "E"], via: "chosen" });
    expect(computeRouting(makeRecipe({ facets: ["C", "D", "E"] }), unserved)[picked]).toEqual({ contenders: ["D", "E"], via: "chosen" });
  });

  test("facets the catalog doesn't know are ignored", () => {
    expect(computeRouting(makeRecipe({ facets: ["A", "Nope"] }), small)[shared]).toEqual({ owner: "A", contenders: ["A"], via: "only" });
  });
});
