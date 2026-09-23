import type { ExportProjectFileFn } from "../../model/api";
import { slug } from "./slug";

/**
 * `.lattice.json`: the project and its deployment records (spec L496, L516), exactly as given. There's no
 * catalog here to normalize the recipe against, so it's written as the store holds it; `parseProjectFile`
 * reports anything that doesn't parse. 2-space indent, one trailing newline, named after the project
 * ("GovernedVault" -> "governed-vault.lattice.json", spec L496).
 */
export const exportProjectFile: ExportProjectFileFn = (project, deployments) => ({
  filename: `${slug(project.name)}.lattice.json`,
  mime: "application/json",
  text: `${JSON.stringify({ project, deployments: [...deployments] }, null, 2)}\n`,
});
