/**
 * The Foundry script exporter's lazy chunk (spec L822: the exporters are their own chunks). Builds C7a's
 * arguments from what Studio holds and returns core's file untouched, byte for byte.
 */
import type { Analysis, Catalog, ExportFile, Hex, Project, Result } from "@lattice-studio/core";
import { exportFoundry } from "@lattice-studio/core";
import { loadCreationCode } from "@/contracts";
import { scriptChainIds } from "../chains";
import { exportRecipe } from "./recipe";
import { STUDIO_VERSION } from "./version";

export type FoundryInput = { project: Project; catalog: Catalog; analysis: Analysis };

export async function foundryScript({ project, catalog, analysis }: FoundryInput): Promise<Result<ExportFile, string>> {
  let proxyCreationCode: Hex | undefined;
  if (project.deploy.path === "createx") {
    const code = await loadCreationCode("Lattice");
    if (!code.ok) return { ok: false, error: `Couldn't load the Lattice proxy's creation code: ${code.error}` };
    proxyCreationCode = code.value;
  }
  return exportFoundry({
    // The script's filename and contract name already key off `project.name` directly; stamping the recipe too
    // (spec L212) costs nothing today (render.ts never reads `recipe.name`, and it's outside the hash) and
    // keeps this exporter from silently drifting from the others if that ever changes.
    project: { ...project, recipe: exportRecipe(project) },
    catalog,
    analysis,
    studioVersion: STUDIO_VERSION,
    chainIds: scriptChainIds(catalog),
    ...(proxyCreationCode === undefined ? {} : { proxyCreationCode }),
  });
}
