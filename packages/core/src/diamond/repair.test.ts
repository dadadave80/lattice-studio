import { describe, expect, test } from "bun:test";
import type { Layout } from "../model/layout";
import { makeCatalog, makeFacet, makeRecipe } from "../testing";
import { withCore, withoutCore } from "./repair";

// Catalog order: Receive, DiamondLoupeFacet, ERC165Facet, OwnableFacet; ERC20 before them all.
const catalog = makeCatalog({
  facets: [
    makeFacet({ name: "ERC20", selectors: ["transfer(address,uint256)"] }),
    makeFacet({ name: "Receive", selectors: [{ hex: "0x00000000", signature: "receive()" }] }),
    makeFacet({ name: "DiamondLoupeFacet", selectors: ["facets()"] }),
    makeFacet({ name: "ERC165Facet", selectors: ["supportsInterface(bytes4)"] }),
    makeFacet({ name: "OwnableFacet", selectors: ["owner()"] }),
  ],
});

describe("withCore", () => {
  test("a recipe with both core facets comes back as the same object", () => {
    const recipe = makeRecipe({ facets: ["ERC20", "DiamondLoupeFacet", "ERC165Facet"] }, catalog);
    expect(withCore(recipe, catalog)).toBe(recipe);
    expect(withCore(recipe, null)).toBe(recipe);
  });

  test("with a catalog, a missing core facet goes in at its catalog position; the rest keep their order", () => {
    expect(withCore(makeRecipe({ facets: ["OwnableFacet", "ERC20"] }, catalog), catalog).facets).toEqual([
      "DiamondLoupeFacet", "ERC165Facet", "OwnableFacet", "ERC20",
    ]);
    expect(withCore(makeRecipe({ facets: ["ERC165Facet", "Receive"] }, catalog), catalog).facets).toEqual(["DiamondLoupeFacet", "ERC165Facet", "Receive"]);
    expect(withCore(makeRecipe({ facets: ["ERC20", "DiamondLoupeFacet", "OwnableFacet"] }, catalog), catalog).facets).toEqual([
      "ERC20", "DiamondLoupeFacet", "ERC165Facet", "OwnableFacet",
    ]);
    // Nothing placed after it in catalog order: appended.
    expect(withCore(makeRecipe({ facets: ["ERC20"] }, catalog), catalog).facets).toEqual(["ERC20", "DiamondLoupeFacet", "ERC165Facet"]);
  });

  test("a name the catalog lacks bounds nothing and is never added", () => {
    const partial = makeCatalog({ facets: catalog.facets.filter((facet) => facet.name !== "ERC165Facet") });
    expect(withCore(makeRecipe({ facets: ["Mystery", "OwnableFacet"] }, partial), partial).facets).toEqual(["Mystery", "DiamondLoupeFacet", "OwnableFacet"]);
    const kept = makeRecipe({ facets: ["DiamondLoupeFacet"] }, partial);
    expect(withCore(kept, partial)).toBe(kept);
  });

  test("without a catalog, the missing core facets are appended in CORE_FACETS order", () => {
    expect(withCore(makeRecipe({ facets: ["Zeta", "Alpha"] }), null).facets).toEqual(["Zeta", "Alpha", "DiamondLoupeFacet", "ERC165Facet"]);
    expect(withCore(makeRecipe({ facets: ["ERC165Facet", "Zeta"] }), null).facets).toEqual(["ERC165Facet", "Zeta", "DiamondLoupeFacet"]);
  });

  test("never touches the input, and copies only the facets", () => {
    const recipe = makeRecipe({ facets: ["ERC20"], owners: { "0xa9059cbb": "ERC20" } }, catalog);
    const before = structuredClone(recipe);
    const repaired = withCore(recipe, catalog);
    expect(recipe).toEqual(before);
    expect(repaired.owners).toBe(recipe.owners);
    expect(repaired.init).toBe(recipe.init);
  });
});

describe("withoutCore", () => {
  test("a layout with no core entry is the same object", () => {
    const layout: Layout = { ERC20: { x: 0, y: 0, pins: "right" } };
    expect(withoutCore(layout)).toBe(layout);
    const empty: Layout = {};
    expect(withoutCore(empty)).toBe(empty);
  });

  test("drops the core's entries and keeps the others, in order", () => {
    const layout: Layout = {
      DiamondLoupeFacet: { x: 1, y: 1, pins: "left" },
      ERC20: { x: 0, y: 0, pins: "right" },
      ERC165Facet: { x: 2, y: 2, pins: "right", expanded: true },
      Receive: { x: 3, y: 3, pins: "left" },
    };
    const out = withoutCore(layout);
    expect(Object.keys(out)).toEqual(["ERC20", "Receive"]);
    expect(out.ERC20).toBe(layout.ERC20);
    expect(layout.DiamondLoupeFacet).toBeDefined();
  });
});
