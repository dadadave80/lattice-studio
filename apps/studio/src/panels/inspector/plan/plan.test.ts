import { describe, expect, test } from "bun:test";
import { analyze, type Catalog } from "@lattice-studio/core";
import { loadFixtureCatalog, makeRecipe } from "@lattice-studio/core/testing";
import { planJson, planObject } from "./plan-json";
import { planRows } from "./plan-rows";

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
});

describe("planJson", () => {
  test("FacetCuts in cut order under the recipe hash, two-space indented", () => {
    const c = catalog();
    const analysis = analyze(makeRecipe({ facets: ["ERC20", "Receive"] }, c), c);
    const object = planObject(analysis);
    expect(object.recipeHash).toBe(analysis.recipeHash);
    expect(object.facetCuts.map((cut) => [cut.facet, cut.action, cut.functionSelectors.length])).toEqual(
      analysis.plan.map((entry) => [entry.facet, "Add", entry.selectors.length]),
    );
    expect(object.facetCuts[0]).toEqual({
      facet: analysis.plan[0]?.facet,
      version: analysis.plan[0]?.version,
      facetAddress: analysis.plan[0]?.address,
      codehash: analysis.plan[0]?.codehash,
      action: "Add",
      functionSelectors: analysis.plan[0]?.selectors,
    });
    const text = planJson(analysis);
    expect(text.endsWith("}\n")).toBe(true);
    expect(JSON.parse(text)).toEqual(object);
    expect(text).toContain('\n  "facetCuts": [');
  });
});
