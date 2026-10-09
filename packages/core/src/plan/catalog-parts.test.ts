import { describe, expect, test } from "bun:test";
import { fieldsOf } from "../init/plan/fields";
import type { InitParam } from "../model/catalog";
import { loadFixtureCatalog, makeCatalog, makeTemplate, recipeOf } from "../testing";
import { splitInitDocs, splitRecipes, templateFacetCount, withInitDocs, withRecipes } from "./catalog-parts";
import { loadTemplate, templateList } from "./templates";

const fixture = loadFixtureCatalog();

function docsOf(params: readonly InitParam[]): (string | undefined)[] {
  return params.flatMap((p) => [p.doc, ...docsOf(p.components ?? [])]);
}

describe.skipIf(!fixture.ok)("splitting the fixture catalog (Q15)", () => {
  const catalog = fixture.ok ? fixture.value : makeCatalog();

  test("templates keep everything but their recipes, and count their cards", () => {
    const { templates, shard } = splitRecipes(catalog.recipes);
    expect(Object.keys(shard)).toEqual(catalog.recipes.map((t) => t.name));
    for (const [i, template] of templates.entries()) {
      const original = catalog.recipes[i];
      if (!original) throw new Error("templates and recipes differ in length");
      expect(template.recipe).toBeUndefined();
      expect(template.facetCount).toBe(templateFacetCount(recipeOf(original)));
      const { facetCount: _count, ...rest } = template;
      const { recipe: _recipe, ...base } = original;
      expect(rest).toEqual(base);
    }
  });

  test("the recipe list reads the same without the recipes; a template loads only once they're back", () => {
    const { templates, shard } = splitRecipes(catalog.recipes);
    const slim = { ...catalog, recipes: templates };
    expect(templateList(slim)).toEqual(templateList(catalog));
    expect(loadTemplate(slim, "GovernedVault")).toEqual({ ok: false, error: "GovernedVault's recipe hasn't loaded." });
    // Refusals don't need the recipe.
    const refused = catalog.recipes.find((t) => t.phase !== "v1");
    if (refused) expect(loadTemplate(slim, refused.name)).toEqual(loadTemplate(catalog, refused.name));
    const back = withRecipes(slim, shard);
    expect(back.recipes.map(({ facetCount: _count, ...template }) => template)).toEqual(catalog.recipes);
    expect({ ...back, recipes: [] }).toEqual({ ...catalog, recipes: [] });
  });

  test("init docs leave every parameter, components included, and come back by path", () => {
    const { inits, shard } = splitInitDocs(catalog.inits);
    expect(inits.flatMap((init) => docsOf(init.params)).filter((doc) => doc !== undefined)).toEqual([]);
    expect(shard["GovernedVaultInit"]?.["p.asset"]).toBeString();
    const slim = { ...catalog, inits };
    expect(withInitDocs(slim, shard)).toEqual(catalog);
  });

  test("a field without its doc has empty help until the docs are back", () => {
    const { inits, shard } = splitInitDocs(catalog.inits);
    const spec = inits.find((init) => init.name === "ERC20Init");
    if (!spec) throw new Error("no ERC20Init");
    expect(fieldsOf(spec, "steps[0]").map((f) => f.doc)).toEqual(["", ""]);
    const filled = withInitDocs({ ...catalog, inits }, shard).inits.find((init) => init.name === "ERC20Init");
    expect(filled && fieldsOf(filled, "steps[0]").map((f) => f.doc)).toEqual(["Token name.", "Token symbol."]);
  });
});

describe("guards", () => {
  test("two templates or init specs with one name can't be split", () => {
    const template = makeTemplate({ name: "Twice" });
    expect(() => splitRecipes([template, template])).toThrow("Two templates are named Twice.");
    const init = { name: "TwiceInit", params: [] };
    expect(() => splitInitDocs([init, init])).toThrow("Two init specs are named TwiceInit.");
  });

  test("a template already carrying its recipe keeps it", () => {
    const template = makeTemplate({ name: "Kept" });
    const catalog = makeCatalog({ recipes: [template] });
    expect(withRecipes(catalog, { Kept: { ...recipeOf(template), facets: [] } }).recipes[0]).toBe(template);
  });
});
