/**
 * `buildSafeBatch` stamps the project's current name onto the recipe (spec L212: "written on export and in
 * share links") through `exportRecipe`, the same helper the console's exporters use (FX22). `project.rename`
 * only ever changes `project.name`, so without the stamp the batch would still carry a stale template name.
 * No DOM here: `downloadSafeBatch` (the app's only caller) is the one that touches it, through `saveFile`.
 */
import type { Catalog, Project } from "@lattice-studio/core";
import { loadTemplate } from "@lattice-studio/core";
import { loadFixtureCatalog, makeProject } from "@lattice-studio/core/testing";
import { describe, expect, test } from "bun:test";
import type { ChainService } from "@/contracts";
import { buildSafeBatch } from "./safe-batch";

const loaded = loadFixtureCatalog();
if (!loaded.ok) throw new Error(loaded.error);
const catalog: Catalog = loaded.value;

const SAFE = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" as const;
const CHAIN_ID = 84532;

/** No chain readiness cached, and no chains listed: `buildSafeBatch` doesn't need either to succeed. */
const service: Pick<ChainService, "chains" | "readiness"> = {
  chains: () => [],
  readiness: () => ({ status: "unknown" }),
};

function erc20(name: string): Project {
  const recipe = loadTemplate(catalog, "ERC20");
  if (!recipe.ok) throw new Error(recipe.error);
  return makeProject({ name, recipe: recipe.value });
}

describe("buildSafeBatch stamps the project's name onto the recipe (spec L212, FX22)", () => {
  test("a renamed project's batch carries the new name, not the template's", async () => {
    const project = erc20("Treasury");
    expect(project.recipe.name).toBe("ERC20");
    const built = await buildSafeBatch(project, catalog, service, SAFE, CHAIN_ID);
    if (!built.ok) throw new Error(built.error);
    expect(built.value.file.filename).toBe("Treasury.safe.json");
    expect(JSON.parse(built.value.file.text).meta.name).toContain("Deploy Treasury to");
  });

  test("a blank project name falls back to the diamond, not the template's name it replaced", async () => {
    const project = erc20("");
    const built = await buildSafeBatch(project, catalog, service, SAFE, CHAIN_ID);
    if (!built.ok) throw new Error(built.error);
    expect(built.value.file.filename).toBe("diamond.safe.json");
    expect(JSON.parse(built.value.file.text).meta.name).toContain("Deploy the diamond to");
  });

  test("the recipe hash it reports, the address and the salt don't move with the name (spec L283)", async () => {
    const named = await buildSafeBatch(erc20("Treasury"), catalog, service, SAFE, CHAIN_ID);
    const unnamed = await buildSafeBatch(erc20(""), catalog, service, SAFE, CHAIN_ID);
    if (!named.ok) throw new Error(named.error);
    if (!unnamed.ok) throw new Error(unnamed.error);
    const hashOf = (text: string): string | undefined => JSON.parse(text).meta.description.match(/recipe (0x[0-9a-f]+)/)?.[1];
    expect(hashOf(named.value.file.text)).toBeDefined();
    expect(hashOf(named.value.file.text)).toBe(hashOf(unnamed.value.file.text));
    expect(named.value.address).toBe(unnamed.value.address);
    expect(named.value.salt).toBe(unnamed.value.salt);
  });
});
