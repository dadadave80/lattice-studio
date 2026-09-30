import { expect, test } from "bun:test";
import { API_OWNERS } from "../model/api";
import { NotImplemented } from "../model/wp";
import { makeCatalog, makeRecipe } from "../testing";
import * as mod from "./index";

test("the barrel exports isCoreFacet, isCoreOnly and coreStatus, C2's", () => {
  expect([API_OWNERS.isCoreFacet, API_OWNERS.isCoreOnly, API_OWNERS.coreStatus]).toEqual(["C2", "C2", "C2"]);
  expect([typeof mod.isCoreFacet, typeof mod.isCoreOnly, typeof mod.coreStatus]).toEqual(["function", "function", "function"]);
});

test("isCoreOnly is true for an empty recipe and for the core alone", () => {
  expect(mod.isCoreOnly({ facets: [] })).toBe(true);
  expect(mod.isCoreOnly({ facets: ["DiamondLoupeFacet", "ERC165Facet"] })).toBe(true);
  expect(mod.isCoreOnly({ facets: ["DiamondLoupeFacet", "ERC165Facet", "Receive"] })).toBe(false);
});

test("isCoreFacet names the loupe and ERC-165 facets only", () => {
  expect(mod.isCoreFacet("DiamondLoupeFacet")).toBe(true);
  expect(mod.isCoreFacet("ERC165Facet")).toBe(true);
  expect(mod.isCoreFacet("Receive")).toBe(false);
});

test("coreStatus reads an empty analysis", () => {
  const catalog = makeCatalog();
  const analysis = {
    recipeHash: catalog.hash, routing: {}, problems: [], plan: [], init: null,
    stats: { facets: 0, routed: 0, exported: 0, excluded: 0, namespaces: 0 },
  };
  let caught: unknown;
  let status: ReturnType<typeof mod.coreStatus> | undefined;
  try {
    status = mod.coreStatus(makeRecipe(), catalog, analysis);
  } catch (error) {
    caught = error;
  }
  expect(caught).not.toBeInstanceOf(NotImplemented);
  expect(caught).toBeUndefined();
  expect(status?.loupe.selectors).toEqual(["0x7a0ed627", "0xadfca15e", "0x52ef6b2c", "0xcdffacc6"]);
  expect(status?.cut).toEqual({ facet: null, rivals: [], conflict: false, immutable: false });
});
