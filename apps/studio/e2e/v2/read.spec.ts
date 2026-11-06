import { parseAbi } from "viem";
import type { Page } from "@playwright/test";
import { expect, test } from "../_support/fixtures";
import { recipeProject } from "../_support/projects";
import { DB_NAME, expectProject, seedProject } from "../_support/seed";
import { deployOnAnvil } from "../q1e/pages/chain";

async function storedProject(page: Page, id: string): Promise<unknown> {
  return page.evaluate(async ({ database, projectId }) => {
    const open = indexedDB.open(database);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    try {
      const request = db.transaction("projects", "readonly").objectStore("projects").get(projectId);
      return await new Promise<unknown>((resolve, reject) => {
        request.onsuccess = () => resolve((request.result as { project: unknown } | undefined)?.project);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }, { database: DB_NAME, projectId: id });
}

test("a deployed route reads and decodes real ERC20 supply without changing the open composition @smoke", async ({ page, anvil }) => {
  const live = await deployOnAnvil(anvil, recipeProject("ERC20", { filled: true }));
  const abi = parseAbi(["function totalSupply() view returns (uint256)"]);
  const expected = await anvil.client.readContract({ address: live.address, abi, functionName: "totalSupply" });
  const composition = recipeProject("GovernedVault", { name: "Work kept while reading" });
  await seedProject(page, { project: composition }, `/#d=31337:${live.address}`);
  const before = await storedProject(page, composition.id);
  expect(before).toEqual(composition);

  const inspector = page.locator('[data-inspector-view="deployed"]');
  await inspector.getByRole("button", { name: "Inspect ERC20", exact: true }).click();
  await expect(inspector.getByRole("heading", { name: "ERC20", exact: true })).toBeVisible();
  const supply = inspector.locator("details").filter({ has: page.locator("summary").filter({ hasText: /^totalSupply\(\) · view$/ }) });
  await supply.locator("summary").click();
  await supply.getByRole("button", { name: "Call", exact: true }).click();
  const result = supply.locator('[aria-label="Call result"]');
  await expect(result.locator("dt")).toHaveText("Output 1 (uint256)");
  await expect(result.locator("dd")).toHaveText(expected.toString());
  await expect(result).toContainText(`Result at block ${live.block}`);
  await expectProject(page, composition.name);
  expect(await storedProject(page, composition.id)).toEqual(before);

  await inspector.getByRole("button", { name: "Back to composition", exact: true }).click();
  await expect(page.locator('[data-inspector-view="diamond"]')).toBeVisible();
  await expectProject(page, composition.name);
  expect(await storedProject(page, composition.id)).toEqual(before);
});
