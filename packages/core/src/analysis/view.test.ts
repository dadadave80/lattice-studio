import { describe, expect, test } from "bun:test";
import type { Catalog } from "../model/catalog";
import type { Recipe } from "../model/recipe";
import { catalog, fixture, S, sheet } from "./test-support";
import { activeSeam, activeSeams, recipeView, signatureOf } from "./view";

const ADAPTERS = ["AxelarGatewayAdapter", "HyperlaneGatewayAdapter"];
const fresh = (): Catalog => structuredClone(catalog());

/** `recipe` with the fields a view reads frozen, as `analyze` settles its normalized copy. */
function settled(recipe: Recipe): Recipe {
  Object.freeze(recipe.facets);
  Object.freeze(recipe.owners);
  Object.freeze(recipe.exclude);
  return recipe;
}

describe("recipeView memo", () => {
  test.skipIf(fixture === null)("a settled recipe keeps its view for the same catalog, and gets a new one for another", () => {
    const on = fresh();
    const recipe = settled(sheet([...ADAPTERS]));
    const view = recipeView(recipe, on);
    expect(recipeView(recipe, on)).toBe(view);
    const other = fresh();
    const again = recipeView(recipe, other);
    expect(again).not.toBe(view);
    expect(again.catalog).toBe(other);
    expect([...again.contenders]).toEqual([...view.contenders]);
  });

  test.skipIf(fixture === null)("a recipe that can still change in place gets a new view each time, so an edit always shows", () => {
    const on = fresh();
    const recipe = sheet([...ADAPTERS]);
    const before = recipeView(recipe, on);
    expect(recipeView(recipe, on)).not.toBe(before);
    recipe.facets.push("ERC20");
    const after = recipeView(recipe, on);
    expect(before.contenders.has(S.transfer)).toBe(false);
    expect(after.contenders.get(S.transfer)).toEqual(["ERC20"]);
  });

  test.skipIf(fixture === null)("a view never freezes the recipe or catalog it reads", () => {
    const on = fresh();
    const recipe = sheet([...ADAPTERS]);
    recipeView(recipe, on);
    expect(Object.isFrozen(recipe.facets)).toBe(false);
    expect(Object.isFrozen(on.facets)).toBe(false);
    expect(Object.isFrozen(on.seams)).toBe(false);
  });
});

describe("catalog lookups", () => {
  test.skipIf(fixture === null)("signatureOf reads the first facet in catalog order, and 0x0ef22643 is exportSelectors()", () => {
    const on = catalog();
    for (const facet of on.facets) {
      for (const { hex } of facet.selectors) {
        const selector = hex.toLowerCase() as typeof hex;
        const first = on.facets.flatMap((f) => f.selectors).find((s) => s.hex.toLowerCase() === selector);
        expect(signatureOf(on, selector)).toBe(first?.signature);
      }
    }
    expect(signatureOf(on, S.exportSelectors)).toBe("exportSelectors()");
    expect(signatureOf(on, "0xffffffff")).toBeUndefined();
  });

  test.skipIf(fixture === null)("the active seam per selector is the first in catalog order whose `when` facets are all placed", () => {
    const on = catalog();
    const everything = sheet(on.facets.map((f) => f.name));
    for (const recipe of [sheet([...ADAPTERS]), sheet(["GovernedVault", "ERC20Pausable"]), everything]) {
      const view = recipeView(recipe, on);
      const expected = on.seams.filter(
        (seam, at) =>
          seam.when.every((name) => view.placedNames.has(name)) &&
          !on.seams.slice(0, at).some((earlier) => earlier.selector.toLowerCase() === seam.selector.toLowerCase() && earlier.when.every((name) => view.placedNames.has(name))),
      );
      expect(activeSeams(view)).toEqual([...expected].sort((a, b) => (a.selector.toLowerCase() < b.selector.toLowerCase() ? -1 : 1)));
      for (const seam of expected) expect(activeSeam(view, seam.selector.toLowerCase() as typeof seam.selector)).toBe(seam);
    }
    expect(activeSeams(recipeView(everything, on)).length).toBeGreaterThan(0);
  });
});
