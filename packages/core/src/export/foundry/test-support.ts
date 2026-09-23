/** Test support for C7a: v1 fixture recipes with every required argument filled, and their analyses. */
import { analyze } from "../../analysis";
import type { Analysis } from "../../model/analysis";
import type { Catalog } from "../../model/catalog";
import type { Project } from "../../model/project";
import type { Arg, Recipe } from "../../model/recipe";
import { loadTemplate, templateList } from "../../plan";
import { loadFixtureCatalog, makeProject } from "../../testing";

/** Arguments the fixture templates leave for the person to fill in (INIT-01), by template. */
const FILL: Record<string, (recipe: Recipe) => void> = {
  GovernedVault: (recipe) => {
    if (recipe.init.kind !== "bundle") return;
    const p = recipe.init.args["p"] as Record<string, Arg>;
    p["asset"] = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
  },
  SafeDiamondCut: (recipe) => {
    if (recipe.init.kind !== "steps") return;
    const step = recipe.init.steps[0];
    if (step) step.args["safe"] = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
  },
};

export type Fixture = { catalog: Catalog; project: Project; analysis: Analysis };

export function fixtureCatalog(): Catalog {
  const loaded = loadFixtureCatalog();
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

/** The v1 recipes the fixture catalog can load. */
export function v1Recipes(catalog: Catalog): string[] {
  return templateList(catalog)
    .filter((item) => item.loadable)
    .map((item) => item.name);
}

/** A project around template `name` with its required arguments filled and its analysis. */
export function fixtureProject(catalog: Catalog, name: string, deploy?: Partial<Project["deploy"]>): Fixture {
  const loaded = loadTemplate(catalog, name);
  if (!loaded.ok) throw new Error(loaded.error);
  const recipe = loaded.value;
  FILL[name]?.(recipe);
  const base = makeProject({ name, recipe });
  const project: Project = { ...base, deploy: { ...base.deploy, ...deploy } };
  return { catalog, project, analysis: analyze(recipe, catalog, { known: [], unconfirmed: [] }) };
}
