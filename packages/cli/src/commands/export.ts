/**
 * `export foundry | brief | recipe | safe <file>` (spec L507-L528, L921): core's exporters, byte for byte, to
 * stdout or `--out`. Foundry and Safe exports refuse while the recipe has blockers (exit 1, the blockers listed);
 * the brief and recipe JSON are always written (Flow 11: "Always") and the exit code still says whether the
 * recipe has blockers.
 */
import { stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  type ExportFile,
  exportBrief,
  exportFoundry,
  exportRecipeJson,
  exportSafeBatch,
  err,
  type Hex,
  ok,
  plural,
  type Problem,
  type Project,
  type Result,
  type SafeBatchArgs,
} from "@lattice-studio/core";
import type { Parsed } from "../args";
import type { LoadedCatalog } from "../catalogs";
import type { Deps } from "../deps";
import { type DeploySettings, freshEntropyNote, parseAddress, parseChainId, predictDiamond, resolveDeploy } from "../deploy";
import { EXIT, errorMessage, type Failure, invalid } from "../failure";
import type { Input } from "../input";
import { blockerCount, fail, note, writeJson, writeLines } from "../output";
import { analyzeInput, loadCatalogs, loadInput, saltProject } from "../session";
import { STUDIO_VERSION } from "../version";

export type ExportKind = "foundry" | "brief" | "recipe" | "safe";

/** The project to export: the input's own, or one made from a recipe with the command line's salt. */
function projectFor(input: Input, settings: DeploySettings): Project {
  const base: Project = input.project ?? {
    id: "lattice-studio-cli",
    name: input.recipe.name ?? basename(input.file).replace(/(\.lattice)?\.json$/i, ""),
    recipe: input.recipe,
    layout: {},
    deploy: { path: settings.path, entropy: settings.entropy, scope: settings.scope },
    provenance: {},
    predicted: [],
  };
  return { ...base, deploy: { path: settings.path, entropy: settings.entropy, scope: settings.scope } };
}

async function proxyCode(loaded: LoadedCatalog, settings: DeploySettings): Promise<Result<Hex | undefined, Failure>> {
  if (settings.path !== "createx") return ok(undefined);
  const code = await loaded.proxyCode();
  return code.ok ? ok(code.value) : err(invalid(code.error));
}

/** Writes the file where `--out` says (a directory gets the export's own file name), else to stdout. */
async function emit(deps: Deps, json: boolean, out: string | undefined, file: ExportFile, extra: Record<string, unknown> = {}): Promise<Failure | null> {
  if (out === undefined) {
    if (json) writeJson(deps, { ...file, ...extra });
    else deps.stdout(file.text);
    return null;
  }
  let target = resolve(deps.cwd, out);
  try {
    if (out.endsWith("/") || (await stat(target)).isDirectory()) target = join(target, file.filename);
  } catch {
    // Not there yet: `--out` names the file.
  }
  try {
    await writeFile(target, file.text, "utf8");
  } catch (error) {
    return invalid(`Couldn't write ${target}: ${errorMessage(error)}`);
  }
  const bytes = new TextEncoder().encode(file.text).length;
  if (json) writeJson(deps, { filename: file.filename, mime: file.mime, path: target, bytes, ...extra });
  else writeLines(deps, [`Wrote ${target} (${plural(bytes, "byte")}).`]);
  return null;
}

export async function runExport(kind: ExportKind, parsed: Parsed, deps: Deps): Promise<number> {
  const { values } = parsed;
  const json = values.json === true;
  const command = `export ${kind}`;
  const set = await loadCatalogs(values, deps);
  if (!set.ok) return fail(deps, json, set.error);
  const input = await loadInput(command, parsed.args, values, deps, set.value);
  if (!input.ok) return fail(deps, json, input.error);
  const { recipe, loaded } = input.value;
  const catalog = loaded.catalog;

  if (kind === "brief" || kind === "recipe") {
    const analyzed = analyzeInput(input.value, values);
    if (!analyzed.ok) return fail(deps, json, analyzed.error);
    const { analysis } = analyzed.value;
    const file = kind === "brief" ? exportBrief({ recipe, catalog, analysis, studioVersion: STUDIO_VERSION }) : exportRecipeJson(recipe, catalog);
    const failed = await emit(deps, json, values.out, file);
    if (failed !== null) return fail(deps, json, failed);
    const blockers = blockerCount(analysis);
    if (blockers > 0) note(deps, `The recipe has ${plural(blockers, "blocker")}; run lattice-studio check to see them.`);
    return blockers > 0 ? EXIT.blockers : EXIT.ok;
  }

  const project = await saltProject(values, input.value, deps, set.value);
  if (!project.ok) return fail(deps, json, project.error);
  const settings = resolveDeploy(values, project.value?.deploy, deps.random);
  if (!settings.ok) return fail(deps, json, settings.error);
  const code = await proxyCode(loaded, settings.value);
  if (!code.ok) return fail(deps, json, code.error);

  if (kind === "foundry") {
    const ids: number[] = [];
    for (const value of values.chain ?? []) {
      const id = parseChainId(value);
      if (!id.ok) return fail(deps, json, id.error);
      ids.push(id.value);
    }
    const chainIds = [...new Set([...catalog.chains.map((chain) => chain.chainId), ...ids])].sort((a, b) => a - b);
    if (chainIds.length === 0) {
      return fail(deps, json, invalid("export foundry needs --chain <id> (repeatable): the catalog lists no chains to write constants for."));
    }
    const analyzed = analyzeInput(input.value, values);
    if (!analyzed.ok) return fail(deps, json, analyzed.error);
    const { analysis } = analyzed.value;
    const blockers = blockerCount(analysis);
    if (blockers > 0) return refuse(deps, json, blockers, analysis.problems);
    const fresh = freshEntropyNote(settings.value);
    if (fresh !== null) note(deps, fresh);
    const file = exportFoundry({
      project: projectFor(input.value, settings.value),
      catalog,
      analysis,
      studioVersion: STUDIO_VERSION,
      chainIds,
      ...(code.value !== undefined ? { proxyCreationCode: code.value } : {}),
    });
    if (!file.ok) return fail(deps, json, invalid(file.error));
    const failed = await emit(deps, json, values.out, file.value);
    return failed === null ? EXIT.ok : fail(deps, json, failed);
  }

  // Safe batch: the Safe deploys, so it's the account the salt and references are built for.
  const safe = parseAddress(values.safe, "--safe");
  if (!safe.ok) return fail(deps, json, safe.error);
  const chainId = parseChainId(values.chain?.[0]);
  if (!chainId.ok) return fail(deps, json, chainId.error);
  const prediction = predictDiamond(catalog, safe.value, chainId.value, settings.value);
  if (!prediction.ok) return fail(deps, json, prediction.error);
  const analyzed = analyzeInput(input.value, values, { prediction: prediction.value });
  if (!analyzed.ok) return fail(deps, json, analyzed.error);
  const { analysis, ctx } = analyzed.value;
  const blockers = blockerCount(analysis);
  if (blockers > 0) return refuse(deps, json, blockers, analysis.problems);
  const fresh = freshEntropyNote(settings.value);
  if (fresh !== null) note(deps, fresh);
  const context: NonNullable<SafeBatchArgs["context"]> = {
    known: ctx.known,
    unconfirmed: ctx.unconfirmed,
    ...(ctx.knownFrom !== undefined ? { knownFrom: ctx.knownFrom } : {}),
    ...(ctx.unconfirmedFrom !== undefined ? { unconfirmedFrom: ctx.unconfirmedFrom } : {}),
  };
  const file = exportSafeBatch({
    recipe,
    catalog,
    safe: safe.value,
    chainId: chainId.value,
    entropy: settings.value.entropy,
    scope: settings.value.scope,
    path: settings.value.path,
    now: deps.now(),
    studioVersion: STUDIO_VERSION,
    context,
    ...(code.value !== undefined ? { proxyCreationCode: code.value } : {}),
  });
  if (!file.ok) return fail(deps, json, invalid(file.error));
  const failed = await emit(deps, json, values.out, file.value, { address: prediction.value.address, salt: prediction.value.salt });
  return failed === null ? EXIT.ok : fail(deps, json, failed);
}

function refuse(deps: Deps, json: boolean, blockers: number, problems: readonly Problem[]): number {
  return fail(deps, json, {
    exit: EXIT.blockers,
    message: `Resolve ${plural(blockers, "blocker")} to export.`,
    problems: problems.filter((p) => p.severity === "blocker"),
  });
}
