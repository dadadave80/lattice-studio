/**
 * Opening a file from disk: ⌘/Ctrl O, the app menu, or dropping it on the window (Flow 10 step 4, spec L501).
 * Both callers (`cmd/open.ts`, the drop handler in `services.ts`) parse the same way and land here: a
 * `.lattice.json` or `recipe.json` always opens as a new project (never applied to the current sheet).
 * Errors name the file, the path and the reason (spec L501); unknown fields are kept and named (spec L289).
 */
import {
  argProvenance, formatParseIssue, importFile, plural, type Catalog, type ParseIssue,
} from "@lattice-studio/core";
import { createProject, getCatalog } from "@/contracts";
import { persistence } from "@/persist";
import { reportOpenFailure, resetForProjectSwitch, sayNote } from "./cmd/shared";

function stem(filename: string): string {
  const base = filename.replace(/\.(lattice\.json|json)$/i, "");
  return base || "Untitled";
}

/**
 * A file that didn't parse: names the file, the path and the reason (spec L501). The first issue is the
 * reason reported and toasted or shown on the sheet; the rest are extra lines for Copy details, so a file
 * with several problems still names all of them without stacking several Error lines or toasts (only one
 * toast shows at a time, spec L733).
 */
function reportIssues(filename: string, issues: readonly ParseIssue[]): void {
  const lines = issues.length > 0 ? issues.map(formatParseIssue) : [`${filename}: Studio couldn't read this file.`];
  const [reason, ...details] = lines;
  reportOpenFailure(reason ?? `${filename}: Studio couldn't read this file.`, details);
}

function unknownFieldsLine(unknownFields: readonly string[]): void {
  if (unknownFields.length > 0) sayNote(`Studio kept ${plural(unknownFields.length, "field")} it doesn't recognize.`);
}

/** No genuine "last saved" time for a file that just landed here: the count alone (spec L708 covers reopening
 * a stored project, not an import). */
function openedLine(name: string, facetCount: number): void {
  sayNote(`Opened ${name} · ${plural(facetCount, "facet")}.`);
}

/** Parses and opens `text` (named `filename`) as a new project. Never throws. */
export async function openImportedFile(filename: string, text: string): Promise<void> {
  const catalog = getCatalog();
  const catalogs: Catalog[] = catalog ? [catalog] : [];
  const result = importFile(text, filename, catalogs);
  if (!result.ok) {
    reportIssues(filename, result.error);
    return;
  }

  if (result.value.kind === "project") {
    const { project, deployments, unknownFields } = result.value;
    const store = await persistence();
    const imported = await store.importProject(project, deployments);
    if (!imported.ok) {
      reportOpenFailure(`${filename}: ${imported.error}`);
      return;
    }
    resetForProjectSwitch();
    unknownFieldsLine(unknownFields);
    openedLine(imported.value.project.name, imported.value.project.recipe.facets.length);
    if (imported.value.skipped > 0) {
      const n = imported.value.skipped;
      sayNote(
        `${plural(n, "deployment record")} ${n === 1 ? "matches" : "match"} an address another project already holds. ${n === 1 ? "It wasn't" : "They weren't"} imported.`,
      );
    }
    return;
  }

  const { recipe, unknownFields } = result.value;
  const name = recipe.name ?? stem(filename);
  const created = await createProject(recipe, name, { provenance: argProvenance(recipe, catalog, "file") });
  if (!created.ok) {
    reportOpenFailure(`${filename}: ${created.error}`);
    return;
  }
  resetForProjectSwitch();
  unknownFieldsLine(unknownFields);
  openedLine(created.value.name, created.value.recipe.facets.length);
}
