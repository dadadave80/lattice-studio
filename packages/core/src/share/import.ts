import { parseProjectFile, parseRecipe } from "../canonical/parse";
import type { ImportFileFn } from "../model/api";
import type { Catalog } from "../model/catalog";
import type { ImportedFile, ParseIssue, ParseOptions } from "../model/io";
import { err, ok, type Result } from "../model/result";
import { argProvenance, unconfirmedPaths } from "./paths";

function fail(filename: string, message: string): { ok: false; error: ParseIssue[] } {
  return err([{ path: "", message, file: filename }]);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * A `.lattice.json` project file holds `project`; a `recipe.json` holds the recipe's own fields. Content
 * decides; the name decides only when the content is neither (an object with no `project`, `schemaVersion`
 * or `facets`), so a broken project file gets project-file errors.
 */
function isProjectFile(json: unknown, filename: string): boolean {
  if (!isObject(json)) return false;
  if (Object.hasOwn(json, "project")) return true;
  if (Object.hasOwn(json, "schemaVersion") || Object.hasOwn(json, "facets")) return false;
  return /\.lattice\.json$/i.test(filename);
}

function read(text: string, filename: string, catalogs: readonly Catalog[]): Result<ImportedFile, ParseIssue[]> {
  const body = text.replace(/^﻿/, "");
  if (body.trim() === "") return fail(filename, "This file is empty.");
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return fail(filename, "This file isn't valid JSON.");
  }
  const opts: ParseOptions = { catalogs, source: "file", filename };
  if (isProjectFile(json, filename)) {
    const parsed = parseProjectFile(json, opts);
    if (!parsed.ok) return parsed;
    const { value, unknownFields, catalog } = parsed.value;
    const { recipe } = value.project;
    return ok({
      kind: "project",
      // Whatever the file claims about provenance is dropped: a file can't confirm its own addresses (spec L857).
      project: { ...value.project, provenance: argProvenance(recipe, catalog, "file") },
      deployments: value.deployments.map((record) => ({ ...record, fromFile: true as const })),
      unconfirmed: unconfirmedPaths(recipe, catalog),
      unknownFields,
      catalog,
    });
  }
  const parsed = parseRecipe(json, opts);
  if (!parsed.ok) return parsed;
  const { value: recipe, unknownFields, catalog } = parsed.value;
  return ok({ kind: "recipe", recipe, unconfirmed: unconfirmedPaths(recipe, catalog), unknownFields, catalog });
}

/**
 * Opens a dropped or chosen file (Flow 10 step 4, spec L501): a `.lattice.json` project file brings its
 * deployment records, each marked `fromFile` until Studio re-reads the address on-chain; a `recipe.json`
 * brings the recipe. Every literal init argument gets provenance `file`, and `unconfirmed` lists the
 * authority paths holding literal addresses (LINK-01). Errors name the file, the path and the reason, and
 * render with `formatParseIssue`: "recipe.json: facets[3] ‘ERC20X’ isn't in Lattice 0.4.0." Never throws.
 */
export const importFile: ImportFileFn = (text, filename, catalogs) => {
  try {
    return read(text, filename, catalogs);
  } catch (error) {
    const reason = error instanceof RangeError ? "it nests too deeply" : "Studio couldn't read it";
    return fail(filename, `This file can't be opened: ${reason}.`);
  }
};
