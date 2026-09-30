/**
 * Recipe commands (Flow 2, spec L405-L411): load a recipe (in place on an empty sheet, else as a new project),
 * replace this sheet with one (one undo step), and Keep immutable (CORE-02).
 */
import type { Analysis, Catalog, Layout, LineDraft, Recipe, Result } from "@lattice-studio/core";
import {
  analyze, blankDiamond, isCoreOnly, isNotImplemented, lines, loadRecipe, loadTemplate, recipeStats, setImmutable,
  templateList, tidy,
} from "@lattice-studio/core";
import {
  command, createProject, emptyAnalysis, isPlaceholder, layoutMetrics, log, runCommand, type CommandArgsOf,
  type CommandContext, type Enablement,
} from "@/contracts";
import { studioState } from "../runtime";
import { CATALOG_NOT_LOADED, disabled, edit, err, guard, isString, OK, ok, sayNote, unquote } from "./shared";

type LoadArgs = CommandArgsOf<"recipe.load">;
type ReplaceArgs = CommandArgsOf<"recipe.replace">;

/** Not a catalog template (spec L378, L990): core's `blankDiamond`. `recipe.load` takes this name too. */
export const BLANK_DIAMOND = "Blank diamond";

export type LoadedRecipe = { recipe: Recipe; name: string; script?: string };

/** The recipe `name` names, case-insensitively: the Blank diamond or a catalog template that loads in v1. */
export function resolveRecipe(catalog: Catalog, name: string): Result<LoadedRecipe, string> {
  const wanted = unquote(name);
  if (/^blank( diamond)?$/i.test(wanted)) return ok({ recipe: blankDiamond(catalog), name: BLANK_DIAMOND });
  const loaded = loadTemplate(catalog, wanted);
  if (!loaded.ok) return loaded;
  const templateName = loaded.value.template?.name ?? wanted;
  const script = templateList(catalog).find((t) => t.name === templateName)?.script;
  return ok({ recipe: loaded.value, name: templateName, ...(script ? { script } : {}) });
}

function analysisOf(recipe: Recipe, catalog: Catalog): Analysis {
  try {
    return analyze(recipe, catalog);
  } catch (error) {
    if (isNotImplemented(error)) return emptyAnalysis();
    throw error;
  }
}

/** The recipe's cards, tidied (spec L409: "a tidied layout"). */
function tidied(recipe: Recipe, catalog: Catalog, analysis: Analysis): Layout {
  const project = { ...studioState().document.store.getState().project, recipe, layout: {} };
  return tidy(project, catalog, analysis, layoutMetrics);
}

/** "Loaded GovernedVault · 14 facets · 120 selectors · from script/base/defi/DeployGovernedVault.s.sol." (L410) */
function loadedLine(loaded: LoadedRecipe, catalog: Catalog, analysis: Analysis): LineDraft {
  const stats = recipeStats(analysis, catalog);
  return lines.recipeLoaded({
    name: loaded.name, facets: stats.facets, selectors: stats.selectors, ...(loaded.script ? { script: loaded.script } : {}),
  });
}

/** After a load the view fits (spec L409): S4b's Fit, once it's built. */
function fitView(): void {
  if (!isPlaceholder("sheet.zoomFit")) void runCommand({ id: "sheet.zoomFit" }, "api");
}

/** Replaces the open project's recipe and layout in place, as one undo step. */
function replaceInPlace(loaded: LoadedRecipe, catalog: Catalog): void {
  const analysis = analysisOf(loaded.recipe, catalog);
  const layout = tidied(loaded.recipe, catalog, analysis);
  // Loading resets narration's baseline (spec L304): the flush inside `edit` narrates nothing against the old sheet.
  studioState().analysis.resetBaseline();
  const result = edit((p) => loadRecipe(p, catalog, loaded.recipe, layout), {
    label: `Loaded ${loaded.name}`,
    say: () => [loadedLine(loaded, catalog, analysis)],
    fallback: null,
  });
  if (result.changed) fitView();
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
  if (/^blank( diamond)?$/.test(wanted)) return OK;
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
  async run(ctx, { name }) {
    const catalog = ctx.catalog;
    if (!catalog) return;
    const loaded = resolveRecipe(catalog, name);
    if (!loaded.ok) {
      sayNote(loaded.error);
      return;
    }
    if (isCoreOnly(ctx.project.recipe)) {
      // An empty sheet: the recipe loads in place (spec L408).
      replaceInPlace(loaded.value, catalog);
      return;
    }
    // A sheet with facets: a new project, and this one stays under Projects (spec L408).
    const analysis = analysisOf(loaded.value.recipe, catalog);
    const layout = tidied(loaded.value.recipe, catalog, analysis);
    const created = await createProject(loaded.value.recipe, loaded.value.name, { layout });
    if (!created.ok) {
      log({ tag: "Error", text: created.error });
      return;
    }
    const engine = studioState().analysis;
    engine.say(loadedLine(loaded.value, catalog, analysis));
    engine.flush();
    fitView();
  },
});

export const replaceCommand = command<ReplaceArgs>({
  id: "recipe.replace",
  title: ({ name }) => `Replace this sheet with ${name}`,
  category: "Build",
  enabled: (ctx, args) => recipeEnabled(ctx, args.name),
  run(ctx, { name }) {
    const catalog = ctx.catalog;
    if (!catalog) return;
    const loaded = resolveRecipe(catalog, name);
    if (!loaded.ok) {
      sayNote(loaded.error);
      return;
    }
    replaceInPlace(loaded.value, catalog);
  },
});

export const keepImmutableCommand = command({
  id: "recipe.keepImmutable",
  title: () => "Keep immutable",
  category: "Build",
  palette: true,
  enabled(ctx) {
    return guard(ctx, false) ?? OK;
  },
  run() {
    edit((p) => setImmutable(p, true));
  },
});
