import { expect, test } from "bun:test";
import { API_OWNERS, type ApiName } from "../model/api";
import { NotImplemented } from "../model/wp";
import * as mod from "./index";
import { catalog, stepsRecipe } from "./test-support";

const C1 = (Object.keys(API_OWNERS) as ApiName[]).filter((name) => API_OWNERS[name] === "C1");

test("the barrel exports every C1 function", () => {
  const exported = mod as Record<string, unknown>;
  expect(C1.map((name) => [name, typeof exported[name]])).toEqual(C1.map((name) => [name, "function"]));
});

test("no C1 function is a stub any more", () => {
  const recipe = stepsRecipe();
  const opts = { catalogs: [catalog], source: "file" as const };
  const calls: (() => unknown)[] = [
    () => mod.canonicalJson(recipe),
    () => mod.normalizeRecipe(recipe, catalog),
    () => mod.recipeHash(recipe, catalog),
    () => mod.catalogHash(catalog),
    () => mod.parseRecipe(recipe, opts),
    () => mod.parseProject({}, opts),
    () => mod.parseProjectFile({}, opts),
    () => mod.migrate(recipe),
  ];
  expect(calls).toHaveLength(C1.length);
  for (const call of calls) {
    let caught: unknown;
    try {
      call();
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof NotImplemented).toBe(false);
  }
});
