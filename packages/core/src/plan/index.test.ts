import { expect, test } from "bun:test";
import { API_OWNERS } from "../model/api";
import { NotImplemented } from "../model/wp";
import { addr, makeCatalog, makeProject, makeRecipe } from "../testing";
import * as mod from "./index";

const owned = Object.entries(API_OWNERS)
  .filter(([, wp]) => wp === "C5a")
  .map(([name]) => name);

test("the barrel exports every function WP-C5a owns", () => {
  expect(owned.sort()).toEqual(["blankDiamond", "buildPlan", "comparePlan", "loadTemplate", "projectStatus", "recipeStats", "templateList"]);
  for (const name of owned) expect(typeof (mod as Record<string, unknown>)[name]).toBe("function");
});

test("no function here is a stub any more", () => {
  const catalog = makeCatalog();
  const calls: (() => unknown)[] = [
    () => mod.buildPlan(makeRecipe(), catalog, {}),
    () => mod.comparePlan([], [{ facetAddress: addr(1), functionSelectors: [] }]),
    () => mod.templateList(catalog),
    () => mod.loadTemplate(catalog, "Nope"),
    () => mod.blankDiamond(catalog),
    () => mod.projectStatus(makeProject(), [], null, makeRecipe().catalog.hash),
    () => mod.recipeStats({ recipeHash: catalog.hash, routing: {}, problems: [], plan: [], init: null, stats: { facets: 0, routed: 0, exported: 0, excluded: 0, namespaces: 0 } }, catalog),
  ];
  for (const call of calls) {
    let caught: unknown;
    try {
      call();
    } catch (error) {
      caught = error;
    }
    expect(caught).not.toBeInstanceOf(NotImplemented);
    expect(caught).toBeUndefined();
  }
});
