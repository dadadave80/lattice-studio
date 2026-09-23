/**
 * Projects to seed, built in Node with core against the real catalog (the one the e2e build serves), so what a
 * test opens is exactly what Studio would have saved: the empty sheet, a recipe as Flow 2 loads it, 30 cards with
 * collisions, a share link, and a project file whose deployment records are marked From file.
 *
 * Deterministic: fixed ids, entropy and timestamps. Nothing here touches a page; `seed.ts` writes these into one.
 */
import {
  analyze, blankDiamond, buildSalt, encodeShareLink, exportProjectFile, factoryPredict, importFile, loadTemplate,
  parseProject, recipeHash, tidy, type Catalog, type Deployment, type ExportFile, type Project, type Recipe,
} from "@lattice-studio/core";
import { fillMissingArgs } from "@lattice-studio/core/testing";
import { layoutSizes } from "@lattice-studio/tokens";
import { catalog as builtCatalog } from "./catalog.ts";

/** Anvil's default account 0, the deployer the seeded records name. */
const DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

/** Sepolia: where the seeded From file records say the diamond lives. */
export const SEPOLIA_CHAIN_ID = 11155111;

/** A fixed timestamp for seeded records (2026-09-23T00:00:00Z). */
export const SEEDED_AT = Date.UTC(2026, 8, 23);

/** A fixed, recognizable 11-byte entropy per seed, so predicted addresses are stable across runs. */
function entropy(n: number): `0x${string}` {
  return `0x${n.toString(16).padStart(2, "0").repeat(11)}`;
}

export type ProjectOptions = {
  /** The project's id (the IndexedDB key). Default: derived from the name. */
  id?: string;
  /** The project's name. Default: the recipe's. */
  name?: string;
};

function slug(name: string): string {
  return `e2e-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

/** A project around `recipe` with a tidied layout, as Flow 2 leaves it (spec L409), checked by core's parser. */
export function projectFor(recipe: Recipe, name: string, options: ProjectOptions = {}, from: Catalog = builtCatalog()): Project {
  const base: Project = {
    id: options.id ?? slug(options.name ?? name),
    name: options.name ?? name,
    recipe,
    layout: {},
    deploy: { path: "factory", entropy: entropy(recipe.facets.length), scope: "every-chain" },
    provenance: {},
    predicted: [],
  };
  const project: Project = { ...base, layout: tidy(base, from, analyze(recipe, from), layoutSizes) };
  const parsed = parseProject(JSON.parse(JSON.stringify(project)), { catalogs: [from], source: "db" });
  if (!parsed.ok) throw new Error(`The seeded project doesn't parse: ${JSON.stringify(parsed.error)}`);
  return project;
}

export type RecipeOptions = ProjectOptions & {
  /** Fill every argument the template leaves empty (no INIT-01 blockers). Default false: as Flow 2 loads it. */
  filled?: boolean;
};

/** A catalog template ("GovernedVault", "ERC20", "SafeDiamondCut") or "Blank diamond", as a project. */
export function recipeProject(name: string, options: RecipeOptions = {}, from: Catalog = builtCatalog()): Project {
  let recipe: Recipe;
  let title = name;
  if (/^blank( diamond)?$/i.test(name)) {
    recipe = blankDiamond(from);
    title = "Blank diamond";
  } else {
    const loaded = loadTemplate(from, name);
    if (!loaded.ok) throw new Error(loaded.error);
    recipe = loaded.value;
    title = recipe.template?.name ?? name;
  }
  if (options.filled) recipe = fillMissingArgs(recipe, from);
  return projectFor(recipe, title, options, from);
}

/**
 * `count` cards (default 30) with selector collisions: the Blank diamond's facets, then every facet that shares a
 * selector with another, in catalog order. No owners are set, so each contested selector is a SEL-01 blocker.
 */
export function collisionsProject(count = 30, options: ProjectOptions = {}, from: Catalog = builtCatalog()): Project {
  const bySelector = new Map<string, string[]>();
  for (const facet of from.facets) {
    for (const selector of facet.selectors) bySelector.set(selector.hex, [...(bySelector.get(selector.hex) ?? []), facet.name]);
  }
  const colliding = new Set<string>();
  for (const names of bySelector.values()) if (names.length > 1) for (const name of names) colliding.add(name);
  const blank = blankDiamond(from);
  const order = from.facets.map((f) => f.name);
  const chosen = [...new Set([...blank.facets, ...order.filter((name) => colliding.has(name))])].slice(0, count);
  if (chosen.length < count) throw new Error(`The catalog has only ${chosen.length} facets for ${count} colliding cards.`);
  chosen.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const recipe: Recipe = { ...blank, facets: chosen, owners: {}, exclude: [] };
  if (!analyze(recipe, from).problems.some((p) => p.code === "SEL-01")) throw new Error("The seeded cards don't collide.");
  return projectFor(recipe, options.name ?? `${count} cards`, options, from);
}

/** A share link's fragment (`#s=1.…`) for `recipe`, as Share copies it (Flow 10). Open it with `page.goto("/" + link)`. */
export function shareLink(recipe: Recipe): string {
  return encodeShareLink(recipe).fragment;
}

/** A deployment record for `project` on `chainId` at the address core predicts on the factory path. */
export function deploymentFor(project: Project, chainId = SEPOLIA_CHAIN_ID, from: Catalog = builtCatalog()): Deployment {
  const salt = buildSalt(DEPLOYER, project.deploy.scope, project.deploy.entropy);
  const address = factoryPredict({ factory: from.factory.address, proxyInitCodeHash: from.proxy.initCodeHash, from: DEPLOYER, salt });
  return {
    projectId: project.id,
    chainId,
    address,
    path: "factory",
    deployer: DEPLOYER,
    salt,
    status: "confirmed",
    block: 1,
    recipeHash: recipeHash(project.recipe, from),
    catalogHash: from.hash,
    at: new Date(SEEDED_AT).toISOString(),
    verification: "match",
    revision: 1,
  };
}

/**
 * A `.lattice.json` project file (C7b's `exportProjectFile`) holding a filled GovernedVault by default and one
 * deployment record. Opening it marks the record From file (spec L501) and its authority addresses From file.
 * Hand it to a file chooser: `chooser.setFiles(filePayload(file))`.
 */
export function projectFile(project: Project = recipeProject("GovernedVault", { filled: true }), deployments?: Deployment[]): ExportFile {
  return exportProjectFile(project, deployments ?? [deploymentFor(project)]);
}

/** A file in the shape Playwright's `setInputFiles` and `FileChooser.setFiles` take. */
export function filePayload(file: ExportFile): { name: string; mimeType: string; buffer: Buffer } {
  return { name: file.filename, mimeType: file.mime, buffer: Buffer.from(file.text, "utf8") };
}

/**
 * What opening `file` would store (core's `importFile`): the project with its authority paths marked From file,
 * and its records marked `fromFile`. `seedProject` writes this straight into a page's storage.
 */
export function importedProject(file: ExportFile, from: Catalog = builtCatalog()): { project: Project; deployments: Deployment[] } {
  const imported = importFile(file.text, file.filename, [from]);
  if (!imported.ok) throw new Error(`${file.filename} doesn't import: ${JSON.stringify(imported.error)}`);
  if (imported.value.kind !== "project") throw new Error(`${file.filename} imports as a recipe, not a project.`);
  const { project, deployments, unconfirmed } = imported.value;
  const provenance = { ...project.provenance };
  for (const path of unconfirmed) provenance[path] ??= "file";
  return {
    project: { ...project, provenance },
    deployments: deployments.map((d) => ({ ...d, projectId: project.id, fromFile: true })),
  };
}
