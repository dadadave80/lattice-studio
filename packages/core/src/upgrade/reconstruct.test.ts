import { describe, expect, test } from "bun:test";
import { computeRouting } from "../analysis/routing";
import { buildPlan } from "../plan/build";
import { parseRecipe } from "../canonical/parse";
import type { Address, Hex } from "../model/hex";
import type { UpgradeOrigin } from "../model/project";
import { makeCatalog, makeFacet } from "../testing/builders";
import { buildUpgradeCuts } from "./cuts";
import { reconstructUpgrade } from "./reconstruct";
import { resolveUpgrade } from "./resolve";

const a: Address = "0x0000000000000000000000000000000000000011";
const b: Address = "0x0000000000000000000000000000000000000022";
const diamond: Address = "0x0000000000000000000000000000000000000033";
const hash: Hex = `0x${"ab".repeat(32)}`;
const id = (address: Address) => `onchain:${address.toLowerCase()}`;
const facet = makeFacet({ name: "Known", selectors: ["one()", "two()"] });
const catalog = makeCatalog({ facets: [facet] });
const one = facet.selectors[0]!.hex;
const two = facet.selectors[1]!.hex;
const origin = (patch: Partial<UpgradeOrigin> = {}): UpgradeOrigin => ({
  chainId: 1, address: diamond, owner: null, block: 1, blockHash: hash,
  facets: [{ facetAddress: a, functionSelectors: [one] }], codehashes: { [a]: facet.release.codehash, [diamond]: hash }, ...patch,
});

describe("exact upgrade reconstruction", () => {
  test("a known subset retains its actual address and never gains unrouted exports or core", () => {
    const result = reconstructUpgrade(origin(), catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.facets).toEqual([id(a)]);
    expect(result.value.init).toEqual({ kind: "none" });
    expect(result.value.exclude).toEqual([two]);
    expect(result.value.owners).toEqual({ [one]: id(a) });
    const plan = buildPlan(result.value, catalog, computeRouting(result.value, catalog));
    expect(plan.entries).toEqual([expect.objectContaining({ facet: id(a), address: a, selectors: [one] })]);
    expect(buildUpgradeCuts({ diamond, current: origin().facets, desired: plan.entries.map((entry) => ({ facetAddress: entry.address, functionSelectors: entry.selectors })), locked: [] })).toEqual({ ok: true, value: [] });
  });

  test("two instances of identical known code keep separate identities and shared selector owners", () => {
    const facts = origin({ facets: [{ facetAddress: a, functionSelectors: [one] }, { facetAddress: b, functionSelectors: [two] }], codehashes: { [a]: facet.release.codehash, [b]: facet.release.codehash, [diamond]: hash } });
    const result = reconstructUpgrade(facts, catalog);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.exclude).toEqual([]);
    const plan = buildPlan(result.value, catalog, computeRouting(result.value, catalog));
    expect(plan.entries.map((entry) => [entry.facet, entry.address, entry.selectors])).toEqual([[id(a), a, [one]], [id(b), b, [two]]]);
    expect(catalog.facets).toEqual([facet]);
  });

  test("foreign, unexpected known selectors and immutable self selectors round trip exactly", () => {
    const facts = origin({ facets: [{ facetAddress: a, functionSelectors: [one, "0x87654321"] }, { facetAddress: b, functionSelectors: ["0x12345678"] }, { facetAddress: diamond, functionSelectors: ["0x0ef22643"] }], codehashes: { [a]: facet.release.codehash, [b]: hash, [diamond]: hash } });
    const result = reconstructUpgrade(facts, catalog);
    if (!result.ok) throw new Error(result.error);
    const reloaded = parseRecipe(JSON.parse(JSON.stringify(result.value)), { source: "file", catalogs: [catalog] });
    if (!reloaded.ok) throw new Error(JSON.stringify(reloaded.error));
    const resolved = resolveUpgrade(reloaded.value.value, catalog);
    if (!resolved.ok) throw new Error(resolved.error);
    expect(resolved.value.raw.map((row) => row.kind)).toEqual(["extra", "foreign", "self"]);
    const desired = buildPlan(reloaded.value.value, catalog, computeRouting(reloaded.value.value, catalog)).entries.map((entry) => ({ facetAddress: entry.address, functionSelectors: entry.selectors }));
    expect(buildUpgradeCuts({ diamond, current: facts.facets, desired, locked: resolved.value.raw.filter((row) => row.kind !== "self").map((row) => ({ kind: row.kind as "foreign" | "extra", facetAddress: row.address, functionSelectors: row.selectors })) })).toEqual({ ok: true, value: [] });
  });

  test("missing code hashes, conflicting loupe rows and zero addresses are refused", () => {
    for (const facts of [origin({ codehashes: {} }), origin({ facets: [...origin().facets, ...origin().facets] }), origin({ address: "0x0000000000000000000000000000000000000000" }), origin({ facets: [{ facetAddress: diamond, functionSelectors: [one] }], codehashes: {} })]) {
      expect(reconstructUpgrade(facts, catalog).ok).toBe(false);
    }
  });

  test("a portable known label cannot forge trusted metadata", () => {
    const result = reconstructUpgrade(origin(), catalog);
    if (!result.ok) throw new Error(result.error);
    const instance = result.value.facetInstances![id(a)]!;
    expect(resolveUpgrade({ ...result.value, facetInstances: { [id(a)]: { ...instance, codehash: hash } } }, catalog).ok).toBe(false);
  });

  test("resolved metadata never invents an initializer missing from the catalog", () => {
    const result = reconstructUpgrade(origin(), catalog);
    if (!result.ok) throw new Error(result.error);
    const resolved = resolveUpgrade(result.value, catalog);
    if (!resolved.ok) throw new Error(resolved.error);
    expect(resolved.value.catalog.facets.find((candidate) => candidate.name === id(a))?.init).toBeUndefined();
  });

  test("mutable descriptors never reuse a cached view just because the old recipe arrays are frozen", () => {
    const result = reconstructUpgrade(origin({ facets: [{ facetAddress: a, functionSelectors: ["0x12345678"] }], codehashes: { [a]: hash, [diamond]: hash } }), catalog);
    if (!result.ok) throw new Error(result.error);
    const recipe = result.value;
    Object.freeze(recipe.facets); Object.freeze(recipe.owners); Object.freeze(recipe.exclude);
    expect(computeRouting(recipe, catalog)["0x12345678"]?.owner).toBe(id(a));
    const row = recipe.facetInstances![id(a)]!;
    if (row.kind === "known") throw new Error("fixture");
    row.selectors = ["0x87654321"];
    expect(computeRouting(recipe, catalog)["0x12345678"]).toBeUndefined();
    expect(computeRouting(recipe, catalog)["0x87654321"]?.owner).toBe(id(a));
  });

  test("a known instance routing only raw extras keeps its verified release version", () => {
    const result = reconstructUpgrade(origin({ facets: [{ facetAddress: a, functionSelectors: ["0x12345678"] }] }), catalog);
    if (!result.ok) throw new Error(result.error);
    expect(buildPlan(result.value, catalog, computeRouting(result.value, catalog)).entries).toEqual([
      expect.objectContaining({ facet: id(a), address: a, version: facet.release.version, selectors: ["0x12345678"] }),
    ]);
  });
});
