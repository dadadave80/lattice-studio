import { expect, test } from "bun:test";
import type { Project } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { placedBetween } from "./placement";

function project(facets: string[], placed: string[] = facets, id = "p"): Project {
  const layout: Project["layout"] = {};
  for (const [i, name] of placed.entries()) layout[name] = { x: i * 300, y: 0, pins: "left" };
  return makeProject({ id, recipe: makeRecipe({ facets: ["DiamondLoupeFacet", "ERC165Facet", ...facets] }), layout });
}

test("a facet added to the recipe and the sheet was placed", () => {
  const before = project(["ERC20"]);
  const after = project(["ERC20", "ERC4626"]);
  expect(placedBetween(before, after, "edit")).toEqual(["ERC4626"]);
});

test("an undo that brings a card back placed it; a removal placed nothing", () => {
  const two = project(["ERC20", "ERC4626"]);
  const one = project(["ERC20"]);
  expect(placedBetween(two, one, "edit")).toEqual([]);
  expect(placedBetween(one, two, "undo")).toEqual(["ERC4626"]);
});

test("a recipe loaded in place places every new card at once", () => {
  const before = project([], []);
  const after = project(["ERC20", "ERC4626", "VaultCore"]);
  expect(placedBetween(before, after, "edit")).toEqual(["ERC20", "ERC4626", "VaultCore"]);
});

test("the core's facets never count, nor a facet without a card, nor another project opening", () => {
  const before = project([], []);
  const after = project(["ERC20", "Receive"], ["ERC20"]);
  expect(placedBetween(before, after, "edit")).toEqual(["ERC20"]);
  expect(placedBetween(before, project(["ERC20"], ["ERC20"], "other"), "load")).toEqual([]);
  expect(placedBetween(before, project(["ERC20"], ["ERC20"], "other"), "edit")).toEqual([]);
  expect(placedBetween(before, after, "load")).toEqual([]);
});

test("the same recipe array places nothing, whatever moved", () => {
  const before = project(["ERC20"]);
  const after = { ...before, layout: { ERC20: { x: 400, y: 0, pins: "left" as const } } };
  expect(placedBetween(before, after, "drag")).toEqual([]);
});
