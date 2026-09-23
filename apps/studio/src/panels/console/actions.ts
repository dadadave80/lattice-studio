/**
 * What the Export menu, the console verbs and the code tabs do with an export (spec L507-L518): build it through
 * the exporter's lazy chunk, then download it or copy it, and say so in the console. Nothing here imports an
 * exporter directly.
 */
import type { Address, Analysis, Catalog, ExportFile, Hex, Project, Result } from "@lattice-studio/core";
import { isNotImplemented, lines, plural } from "@lattice-studio/core";
import {
  announce, deployController, doc, getAnalysis, getCatalog, log, now, type CommandContext, type Enablement,
} from "@/contracts";
import { copyText } from "@/ui";
import { downloadFile } from "./download";
import { loadExporter } from "./exporters";

/** While the catalog loads or after it failed. */
export const CATALOG_NOT_LOADED = "The catalog hasn't loaded yet";
/** An empty sheet has nothing to export (spec L378's "Place facets first"). */
export const PLACE_FACETS_FIRST = "Place facets first";
/** The Script and Recipe JSON tabs on an empty sheet (spec L699). */
export const PLACE_FACETS_TO_GENERATE = "Place facets to generate a script.";

/** "Resolve 2 blockers to export · F8" (spec L513, L699). */
export function resolveToExport(blockers: number): string {
  return `Resolve ${plural(blockers, "blocker")} to export · F8`;
}

export function blockerCount(analysis: Pick<Analysis, "problems">): number {
  return analysis.problems.filter((p) => p.severity === "blocker").length;
}

const OK: Enablement = { ok: true };

/** Enabled when the catalog is in; the brief and recipe.json export whatever the sheet holds (spec L514-L515). */
export function alwaysExportable(ctx: Pick<CommandContext, "catalog">): Enablement {
  return ctx.catalog ? OK : { ok: false, reason: CATALOG_NOT_LOADED };
}

/** The Foundry script and the Safe batch: facets placed and no blockers (spec L513, L517). */
export function deployableExport(ctx: Pick<CommandContext, "catalog" | "project" | "analysis">): Enablement {
  if (!ctx.catalog) return { ok: false, reason: CATALOG_NOT_LOADED };
  if (ctx.project.recipe.facets.length === 0) return { ok: false, reason: PLACE_FACETS_FIRST };
  const blockers = blockerCount(ctx.analysis);
  if (blockers > 0) return { ok: false, reason: resolveToExport(blockers), fix: { id: "problem.next" } };
  return OK;
}

type Sources = { project: Project; catalog: Catalog; analysis: Analysis };

function sources(): Result<Sources, string> {
  const catalog = getCatalog();
  if (!catalog) return { ok: false, error: CATALOG_NOT_LOADED };
  return { ok: true, value: { project: doc.get(), catalog, analysis: getAnalysis() } };
}

export async function scriptFile(from: Sources | null = null): Promise<Result<ExportFile, string>> {
  const input = from ? { ok: true as const, value: from } : sources();
  if (!input.ok) return input;
  const { foundryScript } = await loadExporter("foundry");
  return foundryScript(input.value);
}

export async function briefFile(): Promise<Result<ExportFile, string>> {
  const input = sources();
  if (!input.ok) return input;
  const { agentBrief } = await loadExporter("brief");
  const { project, catalog, analysis } = input.value;
  return { ok: true, value: agentBrief({ recipe: project.recipe, catalog, analysis }) };
}

export async function recipeFile(from: Pick<Sources, "project" | "catalog"> | null = null): Promise<Result<ExportFile, string>> {
  const input = from ? { ok: true as const, value: from } : sources();
  if (!input.ok) return input;
  const { recipeJson } = await loadExporter("recipe");
  return { ok: true, value: recipeJson({ recipe: input.value.project.recipe, catalog: input.value.catalog }) };
}

/** Downloads the file and logs "Exported DeployGovernedVault.s.sol · recipe 0x3f2a…a1c4" (spec L729). */
export function saveExport(file: ExportFile, recipeHash: Hex = getAnalysis().recipeHash): void {
  downloadFile(file);
  const line = lines.exported({ filename: file.filename, recipeHash });
  log(line);
  announce(line.text);
}

/** Copies the file's text: "Copied DeployGovernedVault.s.sol", or the ⌘C fallback when the clipboard is blocked. */
export async function copyExport(file: ExportFile): Promise<void> {
  await copyText(file.text, { label: file.filename });
}

/** Says why an export didn't happen: a console line and the status region. */
export function exportFailed(reason: string): void {
  log({ tag: "Error", text: reason });
  announce(reason, { politeness: "assertive" });
}

/**
 * Builds the Safe batch for `safe` on `chainId`, downloads it and records the deploy as Proposed (spec L580), as
 * the review's Download Transaction Builder batch does. Returns why not when it can't.
 */
export async function exportSafe(safe: Address, chainId: number): Promise<Result<{ address: Address }, string>> {
  const input = sources();
  if (!input.ok) return input;
  const { safeBatch } = await loadExporter("safe");
  const built = await safeBatch({ project: input.value.project, catalog: input.value.catalog, safe, chainId, now: now() });
  if (!built.ok) return built;
  const { file, address, salt } = built.value;
  saveExport(file, input.value.analysis.recipeHash);
  try {
    const controller = await deployController();
    controller.proposed({ safe, chainId, address, salt });
  } catch (error) {
    // The file is saved; the record waits for the deploy module. Say so rather than drop it.
    log({ tag: "Note", text: isNotImplemented(error) ? error.message : `Couldn't record the proposal: ${String(error)}` });
  }
  return { ok: true, value: { address } };
}
