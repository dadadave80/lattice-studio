/**
 * Every export writes the project's current name onto the recipe (spec L212: "written on export and in share
 * links"), not whatever `recipe.name` last held from a template load or an import. `project.rename` (S1) only
 * ever touches `project.name`, so each exporter stamps `exportRecipe(project)` on its own (FX22). Renames a
 * project, then proves every format carries the new name and that the reported hash doesn't move, since `name`
 * sits outside it (spec L283).
 */
import { exportRecipeJson } from "@lattice-studio/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { doc, getAnalysis, getCatalog, provideDeployController, type DeployController } from "@/contracts";
import { fixtureCatalog, onCleanup, seedStudio } from "../../../test/harness";
import { briefFile, exportSafe, recipeFile, scriptFile } from "./actions";
import { captureDownloads, erc20Project, resetConsole } from "./test-support";

beforeEach(() => resetConsole());

const SAFE = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" as const;

/** Simulates `project.rename` (S1's `renameProject` touches only `project.name`, spec L212's bug). */
function rename(name: string): void {
  doc.apply("Rename", (p) => ({ project: { ...p, name }, changed: true, summary: "Renamed" }));
}

describe("exports carry the project's name as the recipe name (spec L212, FX22)", () => {
  test("recipe.json's name follows the rename, and the reported hash doesn't move", async () => {
    seedStudio({ project: erc20Project() });
    const hashBefore = getAnalysis().recipeHash;
    rename("Treasury");
    const result = await recipeFile();
    if (!result.ok) throw new Error(result.error);
    expect(JSON.parse(result.value.text).name).toBe("Treasury");
    expect(getAnalysis().recipeHash).toBe(hashBefore);
    const catalog = getCatalog();
    if (!catalog) throw new Error("no catalog");
    expect(result.value).toEqual(exportRecipeJson({ ...doc.get().recipe, name: "Treasury" }, catalog));
  });

  test("a blank name drops recipe.json's name field rather than writing an empty string", async () => {
    seedStudio({ project: erc20Project() });
    rename("");
    const result = await recipeFile();
    if (!result.ok) throw new Error(result.error);
    expect(JSON.parse(result.value.text)).not.toHaveProperty("name");
  });

  test("the agent brief's title and filename follow the rename", async () => {
    seedStudio({ project: erc20Project() });
    rename("Treasury");
    const result = await briefFile();
    if (!result.ok) throw new Error(result.error);
    expect(result.value.text.split("\n")[0]).toBe("# Treasury agent brief");
    expect(result.value.filename).toBe("treasury.brief.md");
  });

  test("a blank name falls back to Untitled diamond, not the template's name it replaced", async () => {
    seedStudio({ project: erc20Project() });
    expect(doc.get().recipe.name).toBe("ERC20");
    rename("");
    const result = await briefFile();
    if (!result.ok) throw new Error(result.error);
    expect(result.value.text.split("\n")[0]).toBe("# Untitled diamond agent brief");
    expect(result.value.filename).toBe("untitled.brief.md");
  });

  test("the Foundry script already keys off project.name directly; the rename still lands (no regression)", async () => {
    seedStudio({ project: erc20Project() });
    rename("Treasury");
    const result = await scriptFile();
    if (!result.ok) throw new Error(result.error);
    expect(result.value.filename).toBe("DeployTreasury.s.sol");
  });

  test("the Safe batch's label and filename follow the rename", async () => {
    const proposals: Parameters<DeployController["proposed"]>[0][] = [];
    const controller = {
      state: () => ({ phase: "idle" as const }), subscribe: () => () => {}, open() {}, changed() {}, sign: async () => {},
      proposed: (batch: Parameters<DeployController["proposed"]>[0]) => void proposals.push(batch),
      deployMissing: async () => {}, keepWaiting() {}, checkWallet() {}, reviewAgain() {}, discardProposal() {}, retry() {}, close() {},
    } satisfies DeployController;
    onCleanup(provideDeployController(async () => controller));
    seedStudio({ project: erc20Project(), catalog: fixtureCatalog() });
    rename("Treasury");
    const files = captureDownloads();
    const result = await exportSafe(SAFE, 84532);
    if (!result.ok) throw new Error(result.error);
    const file = files.at(-1);
    if (!file) throw new Error("no file downloaded");
    expect(file.filename).toBe("Treasury.safe.json");
    expect(JSON.parse(file.text).meta.name).toContain("Deploy Treasury to");
    await vi.waitFor(() => expect(proposals).toHaveLength(1));
  });
});
