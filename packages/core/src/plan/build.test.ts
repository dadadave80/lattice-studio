import { describe, expect, test } from "bun:test";
import type { Routing } from "../model/analysis";
import type { Catalog } from "../model/catalog";
import type { Hex4 } from "../model/hex";
import type { Recipe } from "../model/recipe";
import { loadFixtureCatalog, makeCatalog, makeFacet, makeRecipe } from "../testing";
import { buildPlan } from "./build";
import { loadTemplate } from "./templates";

/**
 * A stand-in for C2's `computeRouting` (these tests must not depend on its WP): every exported selector of a
 * placed facet, contenders in catalog order; excluded selectors get no owner; an explicit owner among the
 * contenders wins; a single contender owns it; anything else is unresolved.
 */
function routeFor(recipe: Recipe, catalog: Catalog): Routing {
  const placed = new Set(recipe.facets);
  const routing: Routing = {};
  for (const facet of catalog.facets) {
    if (!placed.has(facet.name)) continue;
    for (const { hex } of facet.selectors) {
      const route = routing[hex] ?? { contenders: [], via: "only" as const };
      route.contenders.push(facet.name);
      routing[hex] = route;
    }
  }
  for (const [hex, route] of Object.entries(routing) as [Hex4, Routing[Hex4]][]) {
    if (recipe.exclude.includes(hex)) continue;
    const chosen = recipe.owners[hex];
    if (chosen !== undefined && route.contenders.includes(chosen)) {
      route.owner = chosen;
      route.via = "chosen";
    } else if (route.contenders.length === 1) {
      route.owner = route.contenders[0] as string;
    }
  }
  return routing;
}

const token = makeFacet({ name: "Token", selectors: ["transfer(address,uint256)", "approve(address,uint256)", "totalSupply()"] });
const vault = makeFacet({ name: "Vault", selectors: ["transfer(address,uint256)", "deposit(uint256)"] });
const shadow = makeFacet({ name: "Shadow", selectors: ["approve(address,uint256)"] });
const loupe = makeFacet({ name: "Loupe", selectors: ["facets()", "facetAddresses()"] });
const catalog = makeCatalog({ facets: [token, vault, shadow, loupe] });
const sel = (facet: typeof token, index: number): Hex4 => (facet.selectors[index] as { hex: Hex4 }).hex;

describe("buildPlan", () => {
  test("a partial facet's Add lists only its routed selectors, in the facet's own order", () => {
    const recipe = makeRecipe({ facets: ["Vault", "Token"], owners: { [sel(token, 0)]: "Vault" } });
    const plan = buildPlan(recipe, catalog, routeFor(recipe, catalog));
    expect(plan.entries.map((e) => e.facet)).toEqual(["Token", "Vault"]);
    expect(plan.entries[0]?.selectors).toEqual([sel(token, 1), sel(token, 2)]);
    expect(plan.entries[1]?.selectors).toEqual([sel(vault, 0), sel(vault, 1)]);
    expect(plan.omitted).toEqual([]);
  });

  test("entries carry the release's address, codehash and pinned version", () => {
    const recipe = makeRecipe({ facets: ["Token"] });
    const [entry] = buildPlan(recipe, catalog, routeFor(recipe, catalog)).entries;
    expect(entry).toEqual({
      facet: "Token",
      address: token.release.address,
      codehash: token.release.codehash,
      version: token.release.version,
      selectors: token.selectors.map((s) => s.hex),
    });
  });

  test("a facet that routes nothing gets no Add and is listed as omitted", () => {
    const recipe = makeRecipe({ facets: ["Token", "Shadow", "Loupe"], owners: { [sel(token, 1)]: "Token" } });
    const plan = buildPlan(recipe, catalog, routeFor(recipe, catalog));
    expect(plan.entries.map((e) => e.facet)).toEqual(["Token", "Loupe"]);
    expect(plan.entries.every((e) => e.selectors.length > 0)).toBe(true);
    expect(plan.omitted).toEqual(["Shadow"]);
  });

  test("unresolved and excluded selectors stay out; a fully excluded facet is omitted", () => {
    const recipe = makeRecipe({ facets: ["Token", "Vault", "Loupe"], exclude: [sel(loupe, 0), sel(loupe, 1)] });
    const routing = routeFor(recipe, catalog);
    // Even a routing that names an owner for an excluded selector doesn't put it in the plan.
    routing[sel(loupe, 0)] = { owner: "Loupe", contenders: ["Loupe"], via: "only" };
    const plan = buildPlan(recipe, catalog, routing);
    expect(plan.entries.map((e) => [e.facet, e.selectors])).toEqual([
      ["Token", [sel(token, 1), sel(token, 2)]],
      ["Vault", [sel(vault, 1)]],
    ]);
    expect(plan.omitted).toEqual(["Loupe"]);
  });

  test("the plan's selector count equals the routed selectors", () => {
    const recipe = makeRecipe({ facets: ["Token", "Vault", "Shadow", "Loupe"], owners: { [sel(token, 0)]: "Token", [sel(token, 1)]: "Shadow" } });
    const routing = routeFor(recipe, catalog);
    const plan = buildPlan(recipe, catalog, routing);
    const routed = Object.values(routing).filter((r) => r.owner !== undefined).length;
    expect(plan.entries.reduce((n, e) => n + e.selectors.length, 0)).toBe(routed);
    expect(new Set(plan.entries.flatMap((e) => e.selectors)).size).toBe(routed);
  });

  test("placement order never changes the plan: catalog order wins", () => {
    const a = makeRecipe({ facets: ["Loupe", "Vault", "Token"], owners: { [sel(token, 0)]: "Vault" } });
    const b = makeRecipe({ facets: ["Token", "Loupe", "Vault"], owners: { [sel(token, 0)]: "Vault" } });
    expect(buildPlan(a, catalog, routeFor(a, catalog))).toEqual(buildPlan(b, catalog, routeFor(b, catalog)));
  });

  test("an empty recipe has an empty plan", () => {
    const recipe = makeRecipe();
    expect(buildPlan(recipe, catalog, {})).toEqual({ entries: [], omitted: [] });
  });

  const fixture = loadFixtureCatalog();
  test.skipIf(!fixture.ok)("GovernedVault (fixture): no empty Adds, partial facets list only their routed selectors", () => {
    if (!fixture.ok) return;
    const loaded = loadTemplate(fixture.value, "GovernedVault");
    if (!loaded.ok) throw new Error(loaded.error);
    const recipe = loaded.value;
    const routing = routeFor(recipe, fixture.value);
    const plan = buildPlan(recipe, fixture.value, routing);
    expect(plan.entries).toHaveLength(14);
    expect(plan.omitted).toEqual([]);
    const routed = Object.values(routing).filter((r) => r.owner !== undefined).length;
    expect(plan.entries.reduce((n, e) => n + e.selectors.length, 0)).toBe(routed);
    // ERC20 gives transfer (0xa9059cbb) away to GovernedVault: its Add doesn't carry it.
    const erc20 = plan.entries.find((e) => e.facet === "ERC20");
    const governed = plan.entries.find((e) => e.facet === "GovernedVault");
    expect(erc20?.selectors).not.toContain("0xa9059cbb");
    expect(governed?.selectors).toContain("0xa9059cbb");
    const exported = fixture.value.facets.find((f) => f.name === "ERC20")?.selectors.length ?? 0;
    expect(erc20?.selectors.length).toBeLessThan(exported);
    for (const entry of plan.entries) {
      const facet = fixture.value.facets.find((f) => f.name === entry.facet);
      expect(entry.version).toBe(facet?.release.version as string);
      expect(entry.selectors).toEqual(facet?.selectors.map((s) => s.hex).filter((h) => entry.selectors.includes(h)) ?? []);
    }
  });
});
