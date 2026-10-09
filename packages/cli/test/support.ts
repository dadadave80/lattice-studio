/**
 * Test helpers: recipe and project files written to temporary directories, the CLI run in-process with fake
 * dependencies (`runCli`) and as a real process (`spawnCli`), and the catalogs the tests check against.
 */
import { afterAll } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  type Analysis,
  analyze,
  type Catalog,
  type Deployment,
  exportRecipeJson,
  importFile,
  loadTemplate,
  type Project,
  type Recipe,
  toChecksum,
  validateCatalog,
} from "@lattice-studio/core";
import { loadBuiltCatalog } from "@lattice-studio/core/testing";
import { run } from "../src/cli";
import type { Deps } from "../src/deps";

export const CLI_DIR = join(import.meta.dir, "..");
export const MAIN = join(CLI_DIR, "src", "main.ts");
export const REPO_ROOT = join(CLI_DIR, "..", "..");
export const FIXTURE_CATALOGS = join(REPO_ROOT, "fixtures", "catalog");

const temps: string[] = [];
afterAll(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A fresh temporary directory, removed after the file's tests. */
export function tempDir(prefix = "lattice-cli-"): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function readCatalog(path: string): Catalog {
  const parsed = validateCatalog(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.ok) throw new Error(`${path} doesn't validate`);
  return parsed.value;
}

const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "catalog", "manifest.json"), "utf8")) as {
  default: string;
  catalogs: { id: string; hash: string; path: string }[];
};

/** The catalog the CLI bundles (`catalog/manifest.json`'s default). */
export const BUILT: Catalog = readCatalog(join(REPO_ROOT, "catalog", manifest.catalogs.find((c) => c.id === manifest.default)?.path ?? ""));
export const BUILT_DEFAULT_ID = manifest.default;
/** K3's fixture catalog, reached with `--catalog fixtures/catalog`. */
export const FIXTURE: Catalog = readCatalog(join(FIXTURE_CATALOGS, "fixture", "index.json"));

/** `BUILT` with its templates' recipes back from `recipes.json` (Q15), which `template` needs. */
const BUILT_WITH_RECIPES = loadBuiltCatalog();

export function template(catalog: Catalog, name: string): Recipe {
  const source = catalog === BUILT && BUILT_WITH_RECIPES.ok ? BUILT_WITH_RECIPES.value : catalog;
  const loaded = loadTemplate(source, name);
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

/** Writes `recipe.json` (as Studio exports it) and returns its path. */
export function writeRecipe(dir: string, recipe: Recipe, catalog: Catalog, name = "recipe.json"): string {
  const path = join(dir, name);
  writeFileSync(path, exportRecipeJson(recipe, catalog).text);
  return path;
}

export const ENTROPY = "0x0102030405060708090a0b";
export const ANVIL_0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
export const SAFE = toChecksum("0x5afe00000000000000000000000000000000a11c");

export function makeProject(recipe: Recipe, deploy: Partial<Project["deploy"]> = {}, extra: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: recipe.name ?? "Diamond",
    recipe,
    layout: {},
    deploy: { path: "factory", entropy: ENTROPY, scope: "every-chain", ...deploy },
    provenance: {},
    predicted: [],
    ...extra,
  };
}

/** Writes a `.lattice.json` project file. */
export function writeProject(dir: string, project: Project, deployments: Deployment[] = [], name = "diamond.lattice.json"): string {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify({ project, deployments }, null, 2)}\n`);
  return path;
}

export type RunResult = { code: number; stdout: string; stderr: string };

/** Runs the CLI in-process with deterministic randomness and time; `deps` overrides any of them. */
export async function runCli(argv: readonly string[], deps: Partial<Deps> = {}): Promise<RunResult> {
  let stdout = "";
  let stderr = "";
  const code = await run(argv, {
    cwd: REPO_ROOT,
    env: {},
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    random: (bytes) => new Uint8Array(bytes).fill(0x42),
    now: () => 1_790_000_000_000,
    hasBun: true,
    ...deps,
  });
  return { code, stdout, stderr };
}

/** Runs `bun src/main.ts` as a real process. */
export async function spawnCli(argv: readonly string[], options: { cwd?: string; cmd?: string[] } = {}): Promise<RunResult> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== "LATTICE_STUDIO_RPC_URL") env[key] = value;
  const proc = Bun.spawn([...(options.cmd ?? ["bun", MAIN]), ...argv], { cwd: options.cwd ?? REPO_ROOT, env, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code, stdout, stderr };
}

/** A recipe file as core reads it (C8's `importFile`), and core's analysis of it with nothing around it. */
export function coreRead(path: string, catalog: Catalog): { recipe: Recipe; analysis: Analysis } {
  const imported = importFile(readFileSync(path, "utf8"), basename(path), [catalog]);
  if (!imported.ok || imported.value.kind !== "recipe") throw new Error(`${path} isn't a recipe`);
  const { recipe } = imported.value;
  return { recipe, analysis: analyze(recipe, catalog, { known: [], unconfirmed: [] }) };
}
