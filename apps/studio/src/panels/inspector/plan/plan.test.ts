import { describe, expect, test } from "bun:test";
import { analyze, CORE_FACETS, loadTemplate, type Catalog } from "@lattice-studio/core";
import { loadFixtureCatalog, makeRecipe } from "@lattice-studio/core/testing";
import { planJson, planObject } from "./plan-json";
import { omittedFacets, orderedPlan, planRows } from "./plan-rows";

function catalog(): Catalog {
  const loaded = loadFixtureCatalog();
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

describe("planRows", () => {
  test("[00] ADD name, address and routed/total, ⟂ while a selector is contested", () => {
    const c = catalog();
    const analysis = analyze(makeRecipe({ facets: ["HyperlaneGatewayAdapter", "AxelarGatewayAdapter"] }, c), c);
    const rows = planRows(analysis, c);
    expect(rows.map((r) => [r.index, r.facet, r.count, r.contested])).toEqual([
      ["[00]", "AxelarGatewayAdapter", "7/9 selectors", true],
      ["[01]", "HyperlaneGatewayAdapter", "10/12 selectors", true],
    ]);
    expect(rows[0]?.address).toBe(c.facets.find((f) => f.name === "AxelarGatewayAdapter")?.release.address);
  });

  test("no ⟂ once every selector has an owner", () => {
    const c = catalog();
    const analysis = analyze(makeRecipe({ facets: ["ERC20"] }, c), c);
    expect(planRows(analysis, c)).toEqual([
      expect.objectContaining({ index: "[00]", facet: "ERC20", routed: 9, exported: 9, count: "9/9 selectors", contested: false }),
    ]);
  });

  test("without a catalog the total falls back to the routed count", () => {
    const c = catalog();
    const analysis = analyze(makeRecipe({ facets: ["ERC20"] }, c), c);
    expect(planRows(analysis, null)[0]?.count).toBe("9/9 selectors");
  });

  test("the core's entries lead, in CORE_FACETS order, tagged fixed; the cards follow in the plan's order", () => {
    const c = catalog();
    const analysis = analyze(makeRecipe({ facets: ["HyperlaneGatewayAdapter", ...CORE_FACETS, "AxelarGatewayAdapter"] }, c), c);
    const rows = planRows(analysis, c);
    expect(rows.map((r) => [r.index, r.facet, r.count, r.fixed, r.contested])).toEqual([
      ["[00]", "DiamondLoupeFacet", "4/4 selectors", true, false],
      ["[01]", "ERC165Facet", "1/1 selector", true, false],
      ["[02]", "AxelarGatewayAdapter", "7/9 selectors", false, true],
      ["[03]", "HyperlaneGatewayAdapter", "10/12 selectors", false, true],
    ]);
  });

  test("a core-only recipe plans the core's two cuts", () => {
    const c = catalog();
    const analysis = analyze(makeRecipe({ facets: [...CORE_FACETS] }, c), c);
    expect(planRows(analysis, c).map((r) => [r.facet, r.fixed])).toEqual([["DiamondLoupeFacet", true], ["ERC165Facet", true]]);
  });
});

describe("orderedPlan", () => {
  test("puts the core's entries first whatever the analysis's order, and leaves the rest as they were", () => {
    const c = catalog();
    const recipe = makeRecipe({ facets: ["ERC20", ...CORE_FACETS, "Receive"] }, c);
    const plan = analyze(recipe, c).plan;
    const reversed = [...plan].reverse();
    const cards = plan.filter((entry) => !(CORE_FACETS as readonly string[]).includes(entry.facet)).map((entry) => entry.facet);
    expect(orderedPlan(reversed).map((entry) => entry.facet)).toEqual([...CORE_FACETS, ...[...cards].reverse()]);
    expect(orderedPlan(plan).map((entry) => entry.facet)).toEqual([...CORE_FACETS, ...cards]);
  });

  test("a plan without the core is unchanged", () => {
    const c = catalog();
    const plan = analyze(makeRecipe({ facets: ["ERC20", "Receive"] }, c), c).plan;
    expect(orderedPlan(plan)).toEqual(plan);
  });
});

describe("omittedFacets", () => {
  test("names a placed facet that routes nothing, in catalog order (PA L9, §18 #3c)", () => {
    const c = catalog();
    const loaded = loadTemplate(c, "GovernedVault");
    if (!loaded.ok) throw new Error(loaded.error);
    const recipe = { ...loaded.value, facets: [...loaded.value.facets, "ERC20Pausable"] };
    const analysis = analyze(recipe, c);
    expect(analysis.plan.some((entry) => entry.facet === "ERC20Pausable")).toBe(false);
    expect(omittedFacets(analysis.plan, recipe.facets)).toEqual(["ERC20Pausable"]);
  });

  test("empty once every placed facet routes something", () => {
    const c = catalog();
    const analysis = analyze(makeRecipe({ facets: ["ERC20"] }, c), c);
    expect(omittedFacets(analysis.plan, ["ERC20"])).toEqual([]);
  });
});

describe("planJson", () => {
  test("FacetCuts in cut order under the recipe hash, two-space indented", () => {
    const c = catalog();
    const recipe = makeRecipe({ facets: ["ERC20", "Receive"] }, c);
    const analysis = analyze(recipe, c);
    const object = planObject(analysis, recipe.facets);
    expect(object.recipeHash).toBe(analysis.recipeHash);
    expect(object.facetCuts.map((cut) => [cut.facet, cut.action, cut.functionSelectors.length])).toEqual(
      analysis.plan.map((entry) => [entry.facet, "Add", entry.selectors.length]),
    );
    const first = analysis.plan[0];
    if (!first) throw new Error("The plan is empty.");
    expect(object.facetCuts[0]).toEqual({
      facet: first.facet,
      version: first.version,
      facetAddress: first.address,
      codehash: first.codehash,
      action: "Add",
      functionSelectors: [...first.selectors],
    });
    expect(object.omitted).toEqual([]);
    const text = planJson(analysis, recipe.facets);
    expect(text.endsWith("}\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(object);
    expect(text).toContain('\n  "facetCuts": [');
  });

  test("omitted names a placed facet the plan cuts no Add for (PA L9)", () => {
    const c = catalog();
    const loaded = loadTemplate(c, "GovernedVault");
    if (!loaded.ok) throw new Error(loaded.error);
    const recipe = { ...loaded.value, facets: [...loaded.value.facets, "ERC20Pausable"] };
    const analysis = analyze(recipe, c);
    expect(planObject(analysis, recipe.facets).omitted).toEqual(["ERC20Pausable"]);
  });
});
