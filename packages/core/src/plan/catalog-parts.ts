/**
 * The parts of a catalog index that load on first use (Q15): template recipes (`recipes.json`) and init parameter
 * help (`init-docs.json`). catalog-gen splits them out of the index; the app and the tests put them back into a
 * copy of the catalog when a recipe loads or a field shows its help. An index that carries them inline (catalogs
 * written before Q15, the fixtures) needs neither shard.
 */
import { isCoreFacet } from "../diamond/core";
import type { Catalog, InitDocsShard, InitParam, RecipesShard, RecipeTemplate } from "../model/catalog";
import type { Recipe } from "../model/recipe";

/** A template's cards: its recipe's facets without the core's two (decision D18). */
export function templateFacetCount(recipe: Recipe): number {
  return new Set(recipe.facets.filter((name) => !isCoreFacet(name))).size;
}

/** Template entries without their recipes (each keeps its card count), and the recipes by template name. */
export function splitRecipes(templates: readonly RecipeTemplate[]): { templates: RecipeTemplate[]; shard: RecipesShard } {
  const shard: RecipesShard = {};
  const out = templates.map((template): RecipeTemplate => {
    const { recipe, ...rest } = template;
    if (recipe === undefined) return template;
    if (Object.hasOwn(shard, template.name)) throw new Error(`Two templates are named ${template.name}.`);
    shard[template.name] = recipe;
    return { ...rest, facetCount: templateFacetCount(recipe) };
  });
  return { templates: out, shard };
}

function stripDocs(params: readonly InitParam[], prefix: string, docs: Record<string, string>): InitParam[] {
  return params.map((param) => {
    const { doc, components, ...rest } = param;
    const path = `${prefix}${param.name}`;
    if (doc !== undefined) docs[path] = doc;
    const out: InitParam = { ...rest };
    if (components !== undefined) out.components = stripDocs(components, `${path}.`, docs);
    return out;
  });
}

/** Init specs without their parameters' docs, and the docs by init name, then parameter path (`p.asset`). */
export function splitInitDocs<T extends { name: string; params: InitParam[] }>(inits: readonly T[]): { inits: T[]; shard: InitDocsShard } {
  const shard: InitDocsShard = {};
  const out = inits.map((init): T => {
    if (Object.hasOwn(shard, init.name)) throw new Error(`Two init specs are named ${init.name}.`);
    const docs: Record<string, string> = {};
    const params = stripDocs(init.params, "", docs);
    shard[init.name] = docs;
    return { ...init, params };
  });
  return { inits: out, shard };
}

/** A copy of `catalog` whose templates carry their recipes from `shard`; a template that has one keeps it. */
export function withRecipes(catalog: Catalog, shard: RecipesShard): Catalog {
  const recipes = catalog.recipes.map((template): RecipeTemplate => {
    const recipe = Object.hasOwn(shard, template.name) ? shard[template.name] : undefined;
    return template.recipe !== undefined || recipe === undefined ? template : { ...template, recipe };
  });
  return { ...catalog, recipes };
}

function fillDocs(params: readonly InitParam[], prefix: string, docs: Readonly<Record<string, string>>): InitParam[] {
  return params.map((param) => {
    const path = `${prefix}${param.name}`;
    const out: InitParam = { ...param };
    const doc = Object.hasOwn(docs, path) ? docs[path] : undefined;
    if (out.doc === undefined && doc !== undefined) out.doc = doc;
    if (param.components !== undefined) out.components = fillDocs(param.components, `${path}.`, docs);
    return out;
  });
}

/** A copy of `catalog` whose init parameters carry their docs from `shard`; a parameter that has one keeps it. */
export function withInitDocs(catalog: Catalog, shard: InitDocsShard): Catalog {
  const inits = catalog.inits.map((init) =>
    Object.hasOwn(shard, init.name) ? { ...init, params: fillDocs(init.params, "", shard[init.name] ?? {}) } : init,
  );
  return { ...catalog, inits };
}

