/**
 * What every recipe command shares: the catalogs, the input file, the salt, `--confirm`, the readiness probes
 * and the analysis in its context.
 */
import { resolve } from "node:path";
import {
  type Analysis,
  type AnalysisContext,
  analyze,
  type ChainState,
  err,
  ok,
  type Problem,
  type Project,
  type Recipe,
  type Result,
  sameAddress,
} from "@lattice-studio/core";
import type { Values } from "./args";
import { bundledCatalogs, type CatalogSet, readCatalogDir } from "./catalogs";
import { buildContext, type Prediction } from "./deploy";
import type { Deps } from "./deps";
import { type Failure, invalid } from "./failure";
import { type Input, readInput } from "./input";
import { note } from "./output";
import { chainName } from "./probe";

export function loadCatalogs(values: Values, deps: Deps): Promise<Result<CatalogSet, Failure>> {
  return values.catalog !== undefined ? readCatalogDir(resolve(deps.cwd, values.catalog)) : Promise.resolve(bundledCatalogs());
}

/** The file a command works on: its one positional argument, else `--project`. */
export async function loadInput(command: string, args: readonly string[], values: Values, deps: Deps, set: CatalogSet): Promise<Result<Input, Failure>> {
  if (args.length > 1) return err(invalid(`${command} takes one file, not ${args.length}.`));
  const file = args[0] ?? values.project;
  if (file === undefined) return err(invalid(`${command} needs a recipe.json or .lattice.json file, for example: lattice-studio ${command} recipe.json.`));
  const input = await readInput(file, deps.cwd, set);
  if (input.ok) inputNotes(input.value, deps);
  return input;
}

/** Notes that go with a file: a provisional catalog (contracts §3.1) and fields Studio kept without reading. */
function inputNotes(input: Input, deps: Deps): void {
  const provisional = input.loaded.catalog.provisional;
  if (provisional !== undefined) note(deps, `Provisional catalog: ${provisional}`);
  const count = input.unknownFields.length;
  if (count > 0) {
    note(deps, `Studio kept ${count === 1 ? "1 field" : `${count} fields`} it doesn't recognize: ${input.unknownFields.join(", ")}.`);
  }
}

/** The project whose deploy block holds the salt: `--project`, else the input when it's a project file. */
export async function saltProject(values: Values, input: Input | undefined, deps: Deps, set: CatalogSet): Promise<Result<Project | undefined, Failure>> {
  if (values.project === undefined) return ok(input?.project);
  if (input !== undefined && input.file === values.project) return ok(input.project);
  const read = await readInput(values.project, deps.cwd, set);
  if (!read.ok) return read;
  if (read.value.project === undefined) {
    return err(invalid(`--project takes a .lattice.json project file; ${values.project} is a recipe.`));
  }
  return ok(read.value.project);
}

/**
 * `--confirm <path>=<address>` (LINK-01, spec L857): the address must be the one the file puts at that path, in
 * full, so a look-alike can't be confirmed by its first and last characters. Returns the paths still unconfirmed.
 */
export function applyConfirmations(confirms: readonly string[], link01: readonly Problem[], unconfirmed: readonly string[]): Result<string[], Failure> {
  const remaining = new Set(unconfirmed);
  for (const confirm of confirms) {
    const at = confirm.indexOf("=");
    const path = confirm.slice(0, at);
    const address = confirm.slice(at + 1);
    const problem = link01.find((p) => p.params["path"] === path);
    const held = problem?.params["address"];
    if (problem === undefined || typeof held !== "string") {
      return err(invalid(`Nothing to confirm at ${path}: no address from the file receives authority there.`));
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !sameAddress(address, held)) {
      return err(invalid(`${path} holds ${held}, not ${address}. Check the full address, then confirm it again.`));
    }
    remaining.delete(path);
  }
  return ok([...remaining]);
}

export type Analyzed = { analysis: Analysis; ctx: AnalysisContext };

/** The analysis of the input in its context: the project's known addresses, `--confirm`, the deploy, the probes. */
export function analyzeInput(
  input: Pick<Input, "recipe" | "project" | "deployments" | "unconfirmed" | "loaded">,
  values: Values,
  extra: { recipe?: Recipe; prediction?: Prediction; chain?: ChainState } = {},
): Result<Analyzed, Failure> {
  const recipe = extra.recipe ?? input.recipe;
  const catalog = input.loaded.catalog;
  const context = (unconfirmed: readonly string[]): AnalysisContext =>
    buildContext({
      ...(input.project !== undefined ? { project: input.project } : {}),
      deployments: input.deployments,
      unconfirmed,
      ...(extra.prediction !== undefined ? { prediction: extra.prediction } : {}),
      ...(extra.chain !== undefined ? { chain: extra.chain } : {}),
      chainName,
    });
  let unconfirmed: readonly string[] = input.unconfirmed;
  const confirms = values.confirm ?? [];
  if (confirms.length > 0) {
    const first = analyze(recipe, catalog, context(unconfirmed));
    const remaining = applyConfirmations(
      confirms,
      first.problems.filter((p) => p.code === "LINK-01"),
      unconfirmed,
    );
    if (!remaining.ok) return remaining;
    unconfirmed = remaining.value;
  }
  const ctx = context(unconfirmed);
  return ok({ analysis: analyze(recipe, catalog, ctx), ctx });
}
