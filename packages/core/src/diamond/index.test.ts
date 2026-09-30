import { expect, test } from "bun:test";
import { API_OWNERS } from "../model/api";
import { NotImplemented } from "../model/wp";
import { makeCatalog, makeRecipe } from "../testing";
import * as mod from "./index";

test("the barrel exports isCoreFacet and coreStatus, C2's", () => {
  expect([API_OWNERS.isCoreFacet, API_OWNERS.coreStatus]).toEqual(["C2", "C2"]);
  expect([typeof mod.isCoreFacet, typeof mod.coreStatus]).toEqual(["function", "function"]);
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
  expect(status?.cut).toEqual({ facet: null, conflict: false, immutable: false });
});
