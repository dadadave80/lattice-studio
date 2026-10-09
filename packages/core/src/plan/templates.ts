import { normalizeRecipe } from "../canonical/normalize";
import type { BlankDiamondFn, LoadTemplateFn, TemplateListFn } from "../model/api";
import type { Catalog, RecipeTemplate, TemplateItem } from "../model/catalog";
import type { Arg, Recipe } from "../model/recipe";
import { err, ok } from "../model/result";
import { templateFacetCount } from "./catalog-parts";

/** The factory each account proxy deploys through in v1.1 (spec R20, L72; Phasing L958). */
const ACCOUNT_FACTORY: Partial<Record<RecipeTemplate["proxy"], string>> = {
  AccountDiamond: "AccountFactory",
  ModularAccount6900: "AccountFactory6900",
};

/** "Lattice 0.4.0" for the tag "v0.4.0" (spec L403, L501). */
function latticeName(catalog: Catalog): string {
  return `Lattice ${catalog.lattice.tag.replace(/^v(?=[0-9])/, "")}`;
}

/** Only v1 recipes on the plain Lattice proxy load (spec L407, L957). */
function isLoadable(template: RecipeTemplate): boolean {
  return template.phase === "v1" && template.proxy === "Lattice";
}

/**
 * Why a template doesn't load, as clauses: when it arrives (spec L407; Phasing names the phase in place,
 * L953) and, off the plain Lattice proxy, the factory it needs (R20).
 */
function reasons(template: RecipeTemplate): string[] | undefined {
  if (isLoadable(template)) return undefined;
  const clauses: string[] = [];
  if (template.phase === "v1.1") clauses.push("arrives in v1.1");
  else if (template.phase === "later") clauses.push("arrives later");
  if (template.proxy !== "Lattice") {
    const factory = ACCOUNT_FACTORY[template.proxy];
    clauses.push(factory === undefined ? "needs its own factory" : `needs its own factory (${factory})`);
  }
  return clauses;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The list's note: "Arrives in v1.1" (spec L407); account recipes add the factory they need (R20):
 * "Arrives in v1.1 · Needs its own factory (AccountFactory)". Phase "later" reads "Arrives later".
 */
function noteFor(template: RecipeTemplate): string | undefined {
  return reasons(template)?.map(capitalize).join(" · ");
}

/** `loadTemplate`'s refusal: "Account arrives in v1.1 and needs its own factory (AccountFactory)." */
function refusalFor(template: RecipeTemplate): string | undefined {
  const clauses = reasons(template);
  return clauses === undefined ? undefined : `${template.name} ${clauses.join(" and ")}.`;
}

/**
 * Every Lattice recipe in catalog order, for Browse all recipes (spec L407): v1 recipes on the plain Lattice
 * proxy load; the rest carry the note that says when they arrive and, for account recipes, that they need
 * their own factory (R20). `facets` counts the recipe's cards, the core's two left out (decision D18); an index that
 * keeps recipes in a shard (Q15) carries the count as `facetCount`, so the list never waits on it.
 */
export const templateList: TemplateListFn = (catalog) =>
  catalog.recipes.map((template): TemplateItem => {
    const item: TemplateItem = {
      name: template.name,
      script: template.script,
      proxy: template.proxy,
      phase: template.phase,
      loadable: isLoadable(template),
      facets: template.facetCount ?? (template.recipe === undefined ? 0 : templateFacetCount(template.recipe)),
    };
    const note = noteFor(template);
    if (note !== undefined) item.note = note;
    return item;
  });

/** A deep copy of an argument, so the loaded recipe shares nothing with the catalog. */
function copyArg(value: Arg): Arg {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(copyArg);
  const out: { [field: string]: Arg } = {};
  for (const [field, arg] of Object.entries(value)) out[field] = copyArg(arg);
  return out;
}

function copyArgs(args: Record<string, Arg>): Record<string, Arg> {
  const out: Record<string, Arg> = {};
  for (const [name, arg] of Object.entries(args)) out[name] = copyArg(arg);
  return out;
}

function copyInit(init: Recipe["init"]): Recipe["init"] {
  switch (init.kind) {
    case "bundle":
      return { kind: "bundle", spec: init.spec, args: copyArgs(init.args) };
    case "steps":
      return { kind: "steps", steps: init.steps.map((step) => ({ spec: step.spec, args: copyArgs(step.args) })) };
    default:
      return { kind: "none" };
  }
}

/** Case-sensitive first, then case-insensitive, so the console's `recipe governedvault` finds GovernedVault. */
function findTemplate(catalog: Catalog, name: string): RecipeTemplate | undefined {
  const wanted = name.trim();
  return (
    catalog.recipes.find((template) => template.name === wanted) ??
    catalog.recipes.find((template) => template.name.toLowerCase() === wanted.toLowerCase())
  );
}

/**
 * A recipe template as a new recipe (spec L407-L411): its facets, owners, exclusions and init with the
 * template's example arguments (flagged by INIT-05 until changed), copied in so nothing depends on the template
 * afterwards. The catalog stores the zero hash in the template's `catalog.hash` (it can't hold its own hash), so
 * this stamps the live `catalog.hash` into `recipe.catalog.hash` and `template.catalogHash` (contracts §3.1).
 * Refuses a recipe that isn't in the catalog or doesn't load in v1, saying why. An index that keeps recipes in a
 * shard (Q15) has to be given them first (`withRecipes`).
 */
export const loadTemplate: LoadTemplateFn = (catalog, name) => {
  const template = findTemplate(catalog, name);
  if (template === undefined) return err(`‘${name}’ isn't a recipe in ${latticeName(catalog)}.`);
  const refusal = refusalFor(template);
  if (refusal !== undefined) return err(refusal);
  const source = template.recipe;
  if (source === undefined) return err(`${template.name}'s recipe hasn't loaded.`);
  const recipe: Recipe = {
    schemaVersion: 1,
    name: source.name ?? template.name,
    catalog: { tag: catalog.lattice.tag, hash: catalog.hash },
    template: { name: template.name, catalogHash: catalog.hash },
    facets: [...source.facets],
    owners: { ...source.owners },
    exclude: [...source.exclude],
    init: copyInit(source.init),
  };
  if (source.immutable === true) recipe.immutable = true;
  return ok(normalizeRecipe(recipe, catalog));
};

/** The Blank diamond's facets (spec L990): core, AccessControl and its upgrade mechanism. */
export const BLANK_DIAMOND_FACETS = [
  "DiamondLoupeFacet", "ERC165Facet", "Receive", "AccessControl", "AccessControlDiamondCut",
] as const;

/**
 * The Blank diamond (spec L378, L990): DiamondLoupeFacet, ERC165Facet, Receive, AccessControl and
 * AccessControlDiamondCut, with AccessControlInit's admin set to "Deploying account" (`{$ref:"deployer"}`), so a
 * shared Blank diamond gives admin to whoever deploys it, never to the sharer. It isn't a catalog template, so
 * it carries no `template`. Its one expected problem is DEP-02: AccessControlDiamondCut usually ships with
 * EmergencyStop (contracts §4, QUESTIONS Q13).
 */
export const blankDiamond: BlankDiamondFn = (catalog) =>
  normalizeRecipe(
    {
      schemaVersion: 1,
      catalog: { tag: catalog.lattice.tag, hash: catalog.hash },
      facets: [...BLANK_DIAMOND_FACETS],
      owners: {},
      exclude: [],
      init: { kind: "steps", steps: [{ spec: "AccessControlInit", args: { admin: { $ref: "deployer" } } }] },
    },
    catalog,
  );
