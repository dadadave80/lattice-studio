import type { ParseProjectFileFn, ParseProjectFn, ParseRecipeFn } from "../model/api";
import type { Catalog } from "../model/catalog";
import { toChecksum, toLowerHex, type Hex } from "../model/hex";
import type { ParseIssue, ParseOptions, ParseSource, Parsed } from "../model/io";
import type { Deployment, Project, ProjectFile } from "../model/project";
import type { Recipe } from "../model/recipe";
import { err, ok, type Result } from "../model/result";
import { formatPath, validateProject, validateProjectFile, validateRecipe, type Validated } from "../model/schema";
import { runMigrations, type MigrateTarget } from "./migrate";
import { normalizeWith } from "./normalize";

/**
 * One issue as a line: `recipe.json: facets[3] ‘ERC20X’ isn't in Lattice 0.4.0.` (spec L501). The file comes
 * first when known, then the path when it isn't the root.
 */
export function formatParseIssue(issue: ParseIssue): string {
  const file = issue.file === undefined ? "" : `${issue.file}: `;
  const path = issue.path === "" ? "" : `${issue.path} `;
  return `${file}${path}${issue.message}`;
}

/** What the input is called when a message is about all of it. */
const NOUN: Record<ParseSource, string> = { file: "file", link: "link", db: "project" };

/** "Lattice 0.4.0" for the tag "v0.4.0"; other tags as they are. */
function latticeName(catalog: Catalog): string {
  return `Lattice ${catalog.lattice.tag.replace(/^v(?=[0-9])/, "")}`;
}

function issue(path: string, message: string, opts: ParseOptions): ParseIssue {
  return opts.filename === undefined ? { path, message } : { path, message, file: opts.filename };
}

/** Schema issues with the file named; a message about the whole input reads "This file is a list; …". */
function withFile(issues: readonly ParseIssue[], opts: ParseOptions): ParseIssue[] {
  return issues.map((found) =>
    issue(found.path, found.path === "" ? `This ${NOUN[opts.source]} ${found.message}` : found.message, opts),
  );
}

/** The bundled catalog the recipe names, by hash (any letter case); null when this build lacks it. */
function findCatalog(recipe: Recipe, catalogs: readonly Catalog[]): Catalog | null {
  const hash = recipe.catalog.hash.toLowerCase();
  return catalogs.find((catalog) => catalog.hash.toLowerCase() === hash) ?? null;
}

/** Names the catalog lacks: placed facets and init specs. Owners naming unplaced facets are SEL-05's, not ours. */
function semanticIssues(recipe: Recipe, catalog: Catalog, at: readonly string[], opts: ParseOptions): ParseIssue[] {
  const facets = new Set(catalog.facets.map((facet) => facet.name));
  const inits = new Set(catalog.inits.map((init) => init.name));
  const lacks = (name: string): string => `‘${name}’ isn't in ${latticeName(catalog)}.`;
  const out: ParseIssue[] = [];
  recipe.facets.forEach((name, index) => {
    if (!facets.has(name)) out.push(issue(formatPath([...at, "facets", index]), lacks(name), opts));
  });
  const { init } = recipe;
  if (init.kind === "bundle" && !inits.has(init.spec)) out.push(issue(formatPath([...at, "init", "spec"]), lacks(init.spec), opts));
  if (init.kind === "steps") {
    init.steps.forEach((step, index) => {
      if (!inits.has(step.spec)) out.push(issue(formatPath([...at, "init", "steps", index, "spec"]), lacks(step.spec), opts));
    });
  }
  return out;
}

/**
 * Owner keys are selectors in any case, so `0xA9059CBB` and `0xa9059cbb` are one selector. Case variants that
 * name the same facet collapse quietly in normalization; ones that name different facets would silently lose a
 * routing, so each losing key is an issue. The key normalization keeps (the lowercase spelling, which sorts
 * last) is the one the message points to.
 */
function ownerCaseConflicts(recipe: Recipe, at: readonly string[], opts: ParseOptions): ParseIssue[] {
  const groups = new Map<string, string[]>();
  for (const key of Object.keys(recipe.owners).sort()) {
    const lower = key.toLowerCase();
    groups.set(lower, [...(groups.get(lower) ?? []), key]);
  }
  const out: ParseIssue[] = [];
  for (const [selector, keys] of groups) {
    const kept = keys.at(-1);
    if (kept === undefined) continue;
    const keptOwner = recipe.owners[kept as Hex];
    for (const key of keys.slice(0, -1)) {
      const owner = recipe.owners[key as Hex];
      if (owner === keptOwner) continue;
      const message = `routes ${selector} to ${owner ?? ""}, but ${formatPath([...at, "owners", kept])} routes it to ${keptOwner ?? ""}. Choose one owner.`;
      out.push(issue(formatPath([...at, "owners", key]), message, opts));
    }
  }
  return out;
}

function checksum(value: Hex): Hex {
  return toChecksum(value.toLowerCase());
}

function normalizeProject(project: Project, recipe: Recipe): Project {
  return {
    ...project,
    recipe,
    deploy: { ...project.deploy, entropy: toLowerHex(project.deploy.entropy) },
    predicted: project.predicted.map((entry) => ({ ...entry, address: checksum(entry.address) })),
  };
}

function normalizeDeployment(record: Deployment): Deployment {
  const out: Deployment = {
    ...record,
    address: checksum(record.address),
    deployer: checksum(record.deployer),
    salt: toLowerHex(record.salt),
    recipeHash: toLowerHex(record.recipeHash),
    catalogHash: toLowerHex(record.catalogHash),
  };
  if (record.tx !== undefined) out.tx = toLowerHex(record.tx);
  if (record.safeTxHash !== undefined) out.safeTxHash = toLowerHex(record.safeTxHash);
  return out;
}

/** How one document type is validated, where its recipe sits and how a normalized recipe goes back in. */
type Shape<T> = {
  target: MigrateTarget;
  validate: (json: unknown) => Result<Validated<T>, ParseIssue[]>;
  recipePath: readonly string[];
  recipeOf: (value: T) => Recipe;
  normalize: (value: T, recipe: Recipe) => T;
};

/** Migrate, validate, check names against the pinned catalog, normalize. Never throws. */
function parseAs<T>(shape: Shape<T>, json: unknown, opts: ParseOptions): Result<Parsed<T>, ParseIssue[]> {
  const migrated = runMigrations(json, shape.target);
  if (!migrated.ok) return err([issue("", migrated.error.replace(/^This file /, `This ${NOUN[opts.source]} `), opts)]);
  const validated = shape.validate(migrated.value.value);
  if (!validated.ok) return err(withFile(validated.error, opts));
  const recipe = shape.recipeOf(validated.value.value);
  const catalog = findCatalog(recipe, opts.catalogs);
  const issues = [
    ...(catalog === null ? [] : semanticIssues(recipe, catalog, shape.recipePath, opts)),
    ...ownerCaseConflicts(recipe, shape.recipePath, opts),
  ];
  if (issues.length > 0) return err(issues);
  const parsed: Parsed<T> = {
    value: shape.normalize(validated.value.value, normalizeWith(recipe, catalog)),
    unknownFields: validated.value.unknownFields,
    catalog,
  };
  if (migrated.value.from !== migrated.value.to) parsed.migratedFrom = migrated.value.from;
  return ok(parsed);
}

const RECIPE: Shape<Recipe> = {
  target: "recipe",
  validate: validateRecipe,
  recipePath: [],
  recipeOf: (recipe) => recipe,
  normalize: (_, recipe) => recipe,
};

const PROJECT: Shape<Project> = {
  target: "project",
  validate: validateProject,
  recipePath: ["recipe"],
  recipeOf: (project) => project.recipe,
  normalize: normalizeProject,
};

const PROJECT_FILE: Shape<ProjectFile> = {
  target: "projectFile",
  validate: validateProjectFile,
  recipePath: ["project", "recipe"],
  recipeOf: (file) => file.project.recipe,
  normalize: (file, recipe) => ({
    ...file,
    project: normalizeProject(file.project, recipe),
    deployments: file.deployments.map(normalizeDeployment),
  }),
};

/**
 * A `recipe.json` or share payload: migrated, validated, checked against the catalog it names (when this
 * build bundles it) and normalized. Unknown fields are kept in `value` and listed in `unknownFields`.
 * Errors are `{ path, message, file? }`; `formatParseIssue` renders them as spec L501 does.
 */
export const parseRecipe: ParseRecipeFn = (json, opts) => parseAs(RECIPE, json, opts);

/** A project as autosave stores it; the recipe inside is checked and normalized as `parseRecipe` does. */
export const parseProject: ParseProjectFn = (json, opts) => parseAs(PROJECT, json, opts);

/** A `.lattice.json` file: the project and its deployment records (addresses EIP-55, hashes lowercase). */
export const parseProjectFile: ParseProjectFileFn = (json, opts) => parseAs(PROJECT_FILE, json, opts);
