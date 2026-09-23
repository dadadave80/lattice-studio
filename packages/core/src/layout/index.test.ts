import { expect, test } from "bun:test";
import { API_OWNERS } from "../model/api";
import * as mod from "./index";

test("the barrel exports exactly C9's public functions plus contestedSelectors, and no internal helper", () => {
  const owned = Object.entries(API_OWNERS)
    .filter(([, owner]) => owner === "C9")
    .map(([name]) => name);
  const expected = [...owned, "contestedSelectors"].sort();
  expect(Object.keys(mod).sort()).toEqual(expected);
  for (const name of expected) expect(typeof (mod as Record<string, unknown>)[name]).toBe("function");
  for (const helper of ["collisions", "contestedByFacet", "visibleSelectors", "pinsPad", "nearestFree", "orthoRoute", "analysisWith"]) {
    expect(helper in mod).toBe(false);
  }
});
