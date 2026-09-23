/** The agent brief exporter's lazy chunk (spec L514, L822): C7b's `exportBrief`, byte for byte. */
import type { Analysis, Catalog, ExportFile, Recipe } from "@lattice-studio/core";
import { exportBrief } from "@lattice-studio/core";
import { STUDIO_VERSION } from "./version";

export function agentBrief(input: { recipe: Recipe; catalog: Catalog; analysis: Analysis }): ExportFile {
  return exportBrief({ ...input, studioVersion: STUDIO_VERSION });
}
