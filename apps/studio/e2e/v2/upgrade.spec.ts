import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { importFile, type Project } from "@lattice-studio/core";
import { parseAbi } from "viem";
import { expect, test } from "../_support/fixtures";
import { ALICE, deployShared } from "../_support/anvil";
import { catalog, neededFor } from "../_support/catalog";
import { projectFor, recipeProject } from "../_support/projects";
import { DB_NAME, expectProject, seedProject } from "../_support/seed";
import { disableFileSystemAccess } from "../q1d/pages/file-system-access";
import { pressOpen, pressSave } from "../q1d/pages/keys";
import { openProjectRow, openProjectsDialog } from "../q1d/pages/projects-dialog";
import { clickSave, expectSaveCopyDialog } from "../q1d/pages/save-copy-dialog";
import { expectSaveStatus } from "../q1d/pages/shell";
import { deployOnAnvil, predictedAddress } from "../q1e/pages/chain";
import { connectOnAnvil } from "../q1e/pages/wallet";

async function storedProjects(page: Page): Promise<Project[]> {
  return page.evaluate(async (database) => {
    const open = indexedDB.open(database);
    const db = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    try {
      const request = db.transaction("projects", "readonly").objectStore("projects").getAll() as IDBRequest<{ project: Project }[]>;
      const rows = await new Promise<{ project: Project }[]>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      return rows.map((row) => row.project);
    } finally { db.close(); }
  }, DB_NAME);
}

test("a real upgradeable diamond becomes a separate portable plan and reopens without sending @smoke", async ({ page, context, anvil }) => {
  await disableFileSystemAccess(context);
  const blank = recipeProject("Blank diamond", { filled: true });
  const token = recipeProject("ERC20", { filled: true });
  if (blank.recipe.init.kind !== "steps" || token.recipe.init.kind !== "steps") throw new Error("The local upgrade fixture needs explicit step initializers.");
  const deployed = projectFor({ ...blank.recipe, facets: [...new Set([...blank.recipe.facets, ...token.recipe.facets])], init: { kind: "steps", steps: [...blank.recipe.init.steps, ...token.recipe.init.steps] } }, "Upgradeable token");
  await deployShared(anvil, neededFor(deployed.recipe));
  const live = await deployOnAnvil(anvil, deployed);
  const observed = await anvil.client.readContract({ address: live.address, abi: parseAbi(["function facets() view returns ((address facetAddress, bytes4[] functionSelectors)[])"]), functionName: "facets" });
  const composition = recipeProject("GovernedVault", { name: "Original work kept for upgrade" });
  await seedProject(page, { project: composition }, `/#d=31337:${live.address}`);
  await connectOnAnvil(page);
  const remembered = { chainId: 31337, address: predictedAddress(composition) };
  await expect.poll(async () => (await storedProjects(page)).find((project) => project.id === composition.id)?.predicted).toEqual([remembered]);
  const nonce = await anvil.client.getTransactionCount({ address: ALICE });
  const onchain = page.locator('[data-inspector-view="deployed"]');
  await expect(onchain.getByRole("button", { name: "Inspect ERC20", exact: true })).toBeVisible();
  const original = (await storedProjects(page)).find((project) => project.id === composition.id);
  expect(original).toEqual({ ...composition, predicted: [remembered] });
  await onchain.getByRole("button", { name: "Edit as upgrade plan", exact: true }).click();
  const upgradeName = `Upgrade ${live.address.slice(0, 8)}…${live.address.slice(-4)}`;
  await expectProject(page, upgradeName);
  const plan = page.locator('[data-view="upgrade-plan"]');
  await expect(plan.getByRole("heading", { name: upgradeName, exact: true })).toBeVisible();
  await expect(plan.getByText("No selector changes.", { exact: true })).toBeVisible();
  await expect(plan.getByText("No initializer requested.", { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/#(?:d|open)=/);
  await expectSaveStatus(page, "Saved");
  const upgrade = (await storedProjects(page)).find((project) => project.recipe.mode === "upgrade");
  if (!upgrade?.upgrade) throw new Error("Edit as plan did not save a separate upgrade origin.");
  expect(upgrade.id).not.toBe(composition.id);
  expect(upgrade.upgrade.chainId).toBe(31337);
  expect(upgrade.upgrade.address.toLowerCase()).toBe(live.address.toLowerCase());
  expect(upgrade.upgrade.facets).toEqual(observed);
  const block = await anvil.client.getBlock({ blockNumber: BigInt(upgrade.upgrade.block) });
  expect(upgrade.upgrade.blockHash.toLowerCase()).toBe(block.hash.toLowerCase());
  const tokenInstance = Object.entries(upgrade.recipe.facetInstances ?? {}).find(([, instance]) => instance.kind === "known" && instance.catalogFacet === "ERC20");
  if (!tokenInstance) throw new Error("The actual ERC20 instance was not matched to trusted catalog metadata.");
  const [instanceId, instance] = tokenInstance;
  expect(instanceId).toBe(`onchain:${instance.address.toLowerCase()}`);
  expect(instance.codehash).toBe(catalog().facets.find((facet) => facet.name === "ERC20")!.release.codehash);
  expect(upgrade.recipe.init.kind).toBe("none");
  expect((await storedProjects(page)).find((project) => project.id === composition.id)).toEqual(original);
  expect(await anvil.client.getTransactionCount({ address: ALICE })).toBe(nonce);

  // One deliberate selector edit uses the ordinary Inspector and produces an exact Remove delta.
  await page.getByRole("tab", { name: "Structure", exact: true }).click();
  const tree = page.getByRole("tree", { name: "Structure", exact: true });
  await tree.getByRole("treeitem", { name: new RegExp(`^ERC20 at ${instance.address}`, "i") }).dblclick();
  const facet = page.locator('[data-inspector-view="facet"]');
  await expect(facet.getByRole("heading", { name: "ERC20", exact: true })).toBeVisible();
  await facet.locator('button[data-selector="0x095ea7b3"]').click();
  await page.getByRole("button", { name: "Diamond Stored target", exact: true }).click();
  await expect(plan.getByRole("list", { name: "Upgrade diff", exact: true })).toContainText("Remove · 1 selectors");
  await expect(plan.getByRole("list", { name: "Upgrade diff", exact: true })).toContainText("0x095ea7b3");
  await expectSaveStatus(page, "Saved");
  const edited = (await storedProjects(page)).find((project) => project.id === upgrade.id);
  expect(edited?.recipe.exclude).toContain("0x095ea7b3");
  expect(await anvil.client.getTransactionCount({ address: ALICE })).toBe(nonce);

  await pressSave(page);
  await expectSaveCopyDialog(page);
  const downloading = page.waitForEvent("download");
  await clickSave(page);
  const download = await downloading;
  const filePath = await download.path();
  if (!filePath) throw new Error("Save a copy did not produce a portable project file.");
  const text = await readFile(filePath, "utf8");
  const imported = importFile(text, download.suggestedFilename(), [catalog()]);
  if (!imported.ok || imported.value.kind !== "project") throw new Error("The downloaded upgrade plan is not a valid full project file.");
  expect(imported.value.project.recipe).toEqual(edited?.recipe);
  expect(imported.value.project.upgrade).toEqual(upgrade.upgrade);

  await openProjectsDialog(page);
  await openProjectRow(page, composition.name);
  await expectProject(page, composition.name);
  const choosing = page.waitForEvent("filechooser");
  await pressOpen(page);
  await (await choosing).setFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: Buffer.from(text) });
  await expectProject(page, upgradeName);
  await expect(plan.getByRole("heading", { name: upgradeName, exact: true })).toBeVisible();
  await expect(plan.getByRole("list", { name: "Upgrade diff", exact: true })).toContainText("0x095ea7b3");
  const reopened = (await storedProjects(page)).filter((project) => project.recipe.mode === "upgrade");
  expect(reopened.some((project) => JSON.stringify(project.recipe) === JSON.stringify(edited?.recipe) && project.upgrade?.address.toLowerCase() === live.address.toLowerCase())).toBe(true);
  expect((await storedProjects(page)).find((project) => project.id === composition.id)).toEqual(original);
  expect(await anvil.client.getTransactionCount({ address: ALICE })).toBe(nonce);
});
