/** What the recipe commands do (`../recipe.ts` defines them): load a recipe, replace the sheet with one, Keep immutable. */
import type { Analysis, Catalog, Layout, LineDraft, Recipe } from "@lattice-studio/core";
import { analyze, isCoreOnly, isNotImplemented, lines, loadRecipe, recipeStats, setImmutable, tidy } from "@lattice-studio/core";
import {
  createProject, emptyAnalysis, isPlaceholder, layoutMetrics, log, runCommand, type CommandArgsOf, type CommandContext,
} from "@/contracts";
import { studioState } from "../../runtime";
import { resolveRecipe, type LoadedRecipe } from "../recipe";
import { edit, sayNote } from "../shared";

type LoadArgs = CommandArgsOf<"recipe.load">;
type ReplaceArgs = CommandArgsOf<"recipe.replace">;

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

export async function load(ctx: CommandContext, { name }: LoadArgs): Promise<void> {
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
}

export function replace(ctx: CommandContext, { name }: ReplaceArgs): void {
  const catalog = ctx.catalog;
  if (!catalog) return;
  const loaded = resolveRecipe(catalog, name);
  if (!loaded.ok) {
    sayNote(loaded.error);
    return;
  }
  replaceInPlace(loaded.value, catalog);
}

export function keepImmutable(): void {
  edit((p) => setImmutable(p, true));
}
