/**
 * Recipe commands (Flow 2, spec L405-L411): load a recipe (in place on an empty sheet, else as a new project),
 * replace this sheet with one (one undo step), and Keep immutable (CORE-02). A template's recipe can be in the
 * catalog's `recipes.json` (Q15), so loading one waits for that file; asking whether one loads never does. What
 * they do is in `run/recipe.ts`, loaded after the first paint.
 */
import type { Catalog, Recipe, Result } from "@lattice-studio/core";
import { blankDiamond, loadTemplate, templateList } from "@lattice-studio/core";
import { command, type CommandArgsOf, type CommandContext, type Enablement } from "@/contracts";
import { lazyRun } from "./lazy";
import { CATALOG_NOT_LOADED, disabled, err, guard, isString, OK, ok, unquote } from "./shared";

type LoadArgs = CommandArgsOf<"recipe.load">;
type ReplaceArgs = CommandArgsOf<"recipe.replace">;

/** Not a catalog template (spec L378, L990): core's `blankDiamond`. `recipe.load` takes this name too. */
export const BLANK_DIAMOND = "Blank diamond";

export type LoadedRecipe = { recipe: Recipe; name: string; script?: string };

export function isBlank(wanted: string): boolean {
  return /^blank( diamond)?$/i.test(wanted);
}

/**
 * The recipe `name` names, case-insensitively: the Blank diamond or a catalog template that loads in v1. A template
 * needs `catalog` to carry its recipe (`loadRecipeNamed` makes sure it does).
 */
export function resolveRecipe(catalog: Catalog, name: string): Result<LoadedRecipe, string> {
  const wanted = unquote(name);
  if (isBlank(wanted)) return ok({ recipe: blankDiamond(catalog), name: BLANK_DIAMOND });
  const loaded = loadTemplate(catalog, wanted);
  if (!loaded.ok) return loaded;
  const templateName = loaded.value.template?.name ?? wanted;
  const script = templateList(catalog).find((t) => t.name === templateName)?.script;
  return ok({ recipe: loaded.value, name: templateName, ...(script ? { script } : {}) });
}

function parseName(argv: string[]): Result<{ name: string }, string> {
  const name = argv.join(" ").trim();
  return name === "" ? err("Name a recipe: recipe <name>") : ok({ name });
}

function recipeEnabled(ctx: CommandContext, name: unknown): Enablement {
  const blocked = guard(ctx);
  if (blocked) return blocked;
  if (!isString(name)) return disabled("Name a recipe");
  if (!ctx.catalog) return disabled(CATALOG_NOT_LOADED);
  // Cheap for buttons and palette rows, which ask on every change: build the recipe only to learn why not.
  const wanted = unquote(name).toLowerCase();
  if (isBlank(wanted)) return OK;
  const item = templateList(ctx.catalog).find((t) => t.name.toLowerCase() === wanted);
  if (item?.loadable) return OK;
  const loaded = resolveRecipe(ctx.catalog, name);
  return loaded.ok ? OK : disabled(loaded.error);
}

export const loadCommand = command<LoadArgs>({
  id: "recipe.load",
  title: ({ name }) => `Recipe: ${name}`,
  category: "Build",
  console: { verb: "recipe", syntax: "recipe <name>", parse: parseName },
  enabled: (ctx, args) => recipeEnabled(ctx, args.name),
  run: lazyRun("load"),
});

export const replaceCommand = command<ReplaceArgs>({
  id: "recipe.replace",
  title: ({ name }) => `Replace this sheet with ${name}`,
  category: "Build",
  enabled: (ctx, args) => recipeEnabled(ctx, args.name),
  run: lazyRun("replace"),
});

export const keepImmutableCommand = command({
  id: "recipe.keepImmutable",
  title: () => "Keep immutable",
  category: "Build",
  palette: true,
  enabled(ctx) {
    return guard(ctx, false) ?? OK;
  },
  run: lazyRun("keepImmutable"),
});
