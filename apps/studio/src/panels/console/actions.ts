/**
 * What the Export menu, the console verbs and the code tabs do with an export (spec L507-L518): build it through
 * the exporter's lazy chunk, then download it or copy it, and say so in the console. Nothing here imports an
 * exporter directly. Behind the console body's boundary: the commands reach it through `loadConsoleBody()`; when
 * an export can run is `export-enablement.ts`'s, in the entry.
 */
import type { Address, Analysis, Catalog, ExportFile, Hex, Project, Result } from "@lattice-studio/core";
import { isNotImplemented, lines } from "@lattice-studio/core";
import { announce, deployController, doc, getAnalysis, getCatalog, log, now } from "@/contracts";
import { copyText } from "@/ui/copy/copy-text";
import { downloadFile } from "./download";
import { CATALOG_NOT_LOADED } from "./export-enablement";
import { loadExporter } from "./exporters";
import { exportRecipe } from "./exporters/recipe";

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
  return { ok: true, value: agentBrief({ recipe: exportRecipe(project), catalog, analysis }) };
}

export async function recipeFile(from: Pick<Sources, "project" | "catalog"> | null = null): Promise<Result<ExportFile, string>> {
  const input = from ? { ok: true as const, value: from } : sources();
  if (!input.ok) return input;
  const { recipeJson } = await loadExporter("recipe");
  return { ok: true, value: recipeJson({ recipe: exportRecipe(input.value.project), catalog: input.value.catalog }) };
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
  announce(reason);
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
