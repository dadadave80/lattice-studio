/**
 * Reads a `recipe.json` or `.lattice.json` project file through C8's `importFile`, which validates it, migrates
 * it, finds the catalog it names and marks literal authority addresses as coming from a file (LINK-01).
 */
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { type Deployment, type ParseIssue, type Project, type Recipe, err, importFile, ok, type Result } from "@lattice-studio/core";
import { type CatalogSet, type LoadedCatalog, latticeName } from "./catalogs";
import { catalogMismatch, errorMessage, type Failure, invalid } from "./failure";

export type Input = {
  kind: "recipe" | "project";
  /** As the person wrote it, for messages. */
  file: string;
  recipe: Recipe;
  project?: Project;
  deployments: Deployment[];
  /** Authority argument paths holding literal addresses from the file (LINK-01). */
  unconfirmed: string[];
  unknownFields: string[];
  loaded: LoadedCatalog;
};

/** One file, parsed against the catalogs; exit 2 when it doesn't validate, 3 when its catalog isn't available. */
export async function readInput(file: string, cwd: string, set: CatalogSet): Promise<Result<Input, Failure>> {
  let text: string;
  try {
    text = await readFile(resolve(cwd, file), "utf8");
  } catch (error) {
    return err(invalid(`${file} can't be read: ${errorMessage(error)}`));
  }
  const imported = importFile(text, basename(file), set.catalogs.map((entry) => entry.catalog));
  if (!imported.ok) {
    const issues: ParseIssue[] = imported.error;
    return err(invalid(`${file} can't be used: ${issues.length === 1 ? "1 problem" : `${issues.length} problems`} in the file.`, issues));
  }
  const value = imported.value;
  const recipe = value.kind === "project" ? value.project.recipe : value.recipe;
  const loaded = set.catalogs.find((entry) => entry.catalog === value.catalog);
  if (value.catalog === null || loaded === undefined) {
    const available = set.catalogs.map((entry) => `${latticeName(entry.catalog)} (${entry.catalog.hash})`).join(", ");
    return err(
      catalogMismatch(
        `${file} is pinned to catalog ${recipe.catalog.tag} (${recipe.catalog.hash}), which this CLI doesn't have: it has ${available}. ` +
          "Pass --catalog <dir> with that catalog.",
      ),
    );
  }
  return ok({
    kind: value.kind,
    file,
    recipe,
    ...(value.kind === "project" ? { project: value.project } : {}),
    deployments: value.kind === "project" ? value.deployments : [],
    unconfirmed: value.unconfirmed,
    unknownFields: value.unknownFields,
    loaded,
  });
}
