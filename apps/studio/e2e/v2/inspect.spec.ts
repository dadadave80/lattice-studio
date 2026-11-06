import { readFile } from "node:fs/promises";
import { expect, test } from "../_support/fixtures";
import { recipeProject } from "../_support/projects";
import { expectProject, seedProject } from "../_support/seed";
import { deployOnAnvil } from "../q1e/pages/chain";

test("a deployed route inspects a real diamond and exports its passport without replacing the composition @smoke", async ({ page, anvil }) => {
  const live = await deployOnAnvil(anvil, recipeProject("ERC20", { filled: true }));
  const composition = recipeProject("GovernedVault", { name: "Unfinished composition" });
  await seedProject(page, { project: composition }, `/#d=31337:${live.address}`);
  const inspector = page.locator('[data-inspector-view="deployed"]');
  await expect(inspector.getByRole("heading", { name: "Deployed diamond", exact: true })).toBeVisible();
  await expect(inspector.getByRole("button", { name: "Inspect ERC20", exact: true })).toBeVisible();
  await expectProject(page, composition.name);
  const downloading = page.waitForEvent("download");
  await inspector.getByRole("button", { name: "Export passport", exact: true }).click();
  const download = await downloading;
  const path = await download.path();
  if (!path) throw new Error("Passport download did not produce a file.");
  const passport = JSON.parse(await readFile(path, "utf8")) as { kind: string; chainId: number; address: string; digest: string };
  expect(passport.kind).toBe("lattice-passport/v1");
  expect(passport.chainId).toBe(31337);
  expect(passport.address.toLowerCase()).toBe(live.address.toLowerCase());
  expect(passport.digest).toMatch(/^0x[0-9a-f]{64}$/);
  await inspector.getByRole("button", { name: "Inspect ERC20", exact: true }).click();
  await expect(inspector.getByRole("heading", { name: "ERC20", exact: true })).toBeVisible();
  await inspector.getByRole("button", { name: "Back to composition", exact: true }).click();
  await expect(page.locator('[data-inspector-view="diamond"]')).toBeVisible();
  await expectProject(page, composition.name);
  await expect(page).not.toHaveURL(/#(?:d|open)=/);
});

test("a local address without code reports that outcome without a wallet", async ({ page, anvil: _anvil }) => {
  const composition = recipeProject("ERC20", { name: "Saved work", filled: true });
  await seedProject(page, { project: composition }, "/#d=31337:0x0000000000000000000000000000000000000001");
  const inspector = page.locator('[data-inspector-view="deployed"]');
  await expect(inspector.getByText("No contract code at this address.", { exact: true })).toBeVisible();
  await expectProject(page, composition.name);
});
