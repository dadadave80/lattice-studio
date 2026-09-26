/**
 * Flow 13. Deploy again after changes (spec L582-L584), from a diamond that's really live on the test's Anvil node:
 * the stamp and button once the sheet differs from what's live, Deploy again's new salt, the status chip that follows
 * the chain selected in the title block, and the Deployments list grouped by chain, newest first. The review's note
 * about the live diamond, in the review Deploy again… opens.
 */
import type { Deployment } from "@lattice-studio/core";
import { recipeHash } from "@lattice-studio/core";
import { catalog } from "../_support/catalog.ts";
import { focusRegion } from "../_support/keys.ts";
import { deploymentFor, recipeProject } from "../_support/projects.ts";
import { seedProject } from "../_support/seed.ts";
import { NARROW_WIDTHS, expectTier, tierAt, viewportAt } from "../_support/viewports.ts";
import { shortAddress } from "../_support/wallet.ts";
import { deployOnAnvil, recordFor } from "./pages/chain.ts";
import { DeployReview, watchReactErrors } from "./pages/dialogs.ts";
import { expect, test } from "../_support/fixtures.ts";
import { pressMod, runConsoleLine, runPaletteWith, type InputMode } from "./pages/keys.ts";
import { ConsoleLog, Inspector, TitleBar, TitleBlock } from "./pages/regions.ts";
import { connectOnAnvil } from "./pages/wallet.ts";

const MODES: readonly InputMode[] = ["pointer", "keyboard"];

/** "0xa231…accd": how the Deployments list shortens a recipe hash. */
function shortHash(hash: string): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

test.describe("Flow 13. Deploy again after changes", () => {
  for (const mode of MODES) {
    test(`an edit after Live stamps "Modified since r1" and offers Deploy again…; undoing it is Live again (${mode}) @smoke`, async ({ page, anvil }) => {
      const project = recipeProject("GovernedVault", { filled: true });
      const live = await deployOnAnvil(anvil, project);
      await seedProject(page, { project, deployments: [live] });
      await runConsoleLine(page, "chain anvil");

      const block = new TitleBlock(page);
      const bar = new TitleBar(page);
      await expect(block.stamp("Live · Anvil · r1")).toBeVisible();
      await expect(bar.chip("Live · Anvil · r1")).toBeVisible();
      await expect(block.deploy()).toBeVisible();
      expect(await block.addressLine()).toEqual({ label: "Deployed", address: live.address });

      await runConsoleLine(page, "remove receive");
      const log = new ConsoleLog(page);
      await expect(log.line("Note", "Removed Receive.")).toBeVisible();
      await expect(log.line("Note", "The sheet now differs from what's live on Anvil (r1).")).toBeVisible();
      await expect(block.stamp("Modified since r1")).toBeVisible();
      await expect(bar.chip("Modified since r1")).toBeVisible();
      await expect(block.deployAgain()).toBeVisible();
      await expect(block.deploy()).toHaveCount(0);

      if (mode === "pointer") {
        await bar.undo().click();
      } else {
        await focusRegion(page, "Sheet");
        await pressMod(page, "z");
      }
      await expect(block.stamp("Live · Anvil · r1")).toBeVisible();
      await expect(block.deploy()).toBeVisible();
      await expect(block.deployAgain()).toHaveCount(0);
    });
  }

  for (const mode of MODES) {
    test(`Deploy again… draws new salt entropy for a new diamond at a new address (${mode})`, async ({ page, anvil }) => {
      const crashed = watchReactErrors(page);
      const project = recipeProject("GovernedVault", { filled: true });
      const live = await deployOnAnvil(anvil, project);
      await seedProject(page, { project, deployments: [live] });
      await runConsoleLine(page, "chain anvil");
      await runConsoleLine(page, "remove receive");
      const block = new TitleBlock(page);
      await expect(block.stamp("Modified since r1")).toBeVisible();

      if (mode === "pointer") await block.deployAgain().click();
      else await runPaletteWith(page, "keyboard", "Deploy again…");
      await expect(new ConsoleLog(page).lineMatching("Note", /Drew a new salt for a new diamond\./)).toBeVisible();

      // The review opens on the new diamond and says what stays live (spec L584).
      const review = new DeployReview(page, "GovernedVault");
      await review.expectOpen(crashed);
      await expect(review.root).toContainText(
        `This deploys a new diamond at a new address. The live one at ${live.address} stays as it is. Upgrading it in place arrives in v2.`,
      );
      // With the deployer connected, the new salt predicts a new, free address.
      await page.keyboard.press("Escape");
      await expect(review.root).toBeHidden();
      await connectOnAnvil(page);
      await expect.poll(async () => (await block.addressLine())?.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      const fresh = (await block.addressLine())?.address as `0x${string}`;
      expect(fresh).not.toBe(live.address);
      expect(await anvil.rpc<string>("eth_getCode", [fresh, "latest"])).toBe("0x");
    });
  }

  test("with the deployer's wallet connected, Deploy again… stays enabled once modified", async ({ page, anvil }) => {
    // NET-05 is right to block Deploy… here (it keeps the colliding salt); Deploy again… redraws the salt before the
    // review (spec L584), so its enablement should ignore NET-05 for the current prediction · FX27.
    test.fail(
      true,
      "NET-05 fires on the recorded live diamond itself once the deployer connects, so Deploy again… is disabled with \"Resolve 1 blocker · F8\"; spec L584 has Deploy again draw the new salt · FX27 (deploy.again's enablement)",
    );
    const project = recipeProject("GovernedVault", { filled: true });
    const live = await deployOnAnvil(anvil, project);
    await seedProject(page, { project, deployments: [live] });
    await connectOnAnvil(page);
    const block = new TitleBlock(page);
    await expect(block.stamp("Live · Anvil · r1")).toBeVisible();
    await runConsoleLine(page, "remove receive");
    await expect(block.stamp("Modified since r1")).toBeVisible();
    await expect(block.deployAgain()).not.toHaveAttribute("aria-disabled", "true", { timeout: 3_000 });
  });

  test("the status chip follows the chain in the title block; Deployments lists every record by chain, newest first, keyboard only", async ({ page, anvil }) => {
    const project = recipeProject("GovernedVault", { filled: true });
    const live = await deployOnAnvil(anvil, project);
    const hash = recipeHash(project.recipe, catalog());
    // An earlier attempt on Anvil that failed, a day before the live one, and the diamond on Sepolia.
    const failed: Deployment = recordFor(project, {
      address: "0x000000000000000000000000000000000000dEaD",
      salt: live.salt,
      status: "failed",
      at: new Date(Date.parse(live.at) - 86_400_000).toISOString(),
    });
    const sepolia = deploymentFor(project);
    await seedProject(page, { project, deployments: [failed, live, sepolia] });

    await runConsoleLine(page, "chain anvil");
    const bar = new TitleBar(page);
    await expect(bar.chip("Live · Anvil · r1")).toBeVisible();
    await runConsoleLine(page, "chain sepolia");
    await expect(bar.chip("Live · Sepolia · r1")).toBeVisible();
    await runConsoleLine(page, "chain base sepolia");
    await expect(bar.chip("Not deployed")).toBeVisible();

    const inspector = new Inspector(page);
    const deployments = inspector.deployments();
    for (const chain of ["Anvil", "Sepolia"]) await expect(deployments.getByRole("heading", { level: 4, name: chain, exact: true })).toBeVisible();
    const anvilRows = inspector.deploymentsOn("Anvil").getByRole("listitem");
    await expect(anvilRows).toHaveCount(2);
    await expect(anvilRows.nth(0)).toContainText(shortAddress(live.address));
    await expect(anvilRows.nth(0)).toContainText(`recipe ${shortHash(hash)}`);
    await expect(anvilRows.nth(1)).toContainText("Failed");
    await expect(anvilRows.nth(1)).toContainText(shortAddress(failed.address));
    await expect(inspector.deploymentsOn("Sepolia").getByRole("listitem")).toHaveCount(1);
    await expect(inspector.deploymentsOn("Sepolia")).toContainText(`recipe ${shortHash(hash)}`);
  });

  for (const width of NARROW_WIDTHS) {
    test.describe(`at ${width} px`, () => {
      test.use({ viewport: viewportAt(width) });

      test("the chip reads Modified since r1 and Deploy again… sits in the title bar, keyboard only", async ({ page, anvil }) => {
        const project = recipeProject("GovernedVault", { filled: true });
        const live = await deployOnAnvil(anvil, project);
        await seedProject(page, { project, deployments: [live] });
        await expectTier(page, tierAt(width));
        await runConsoleLine(page, "chain anvil");
        const bar = new TitleBar(page);
        await expect(bar.chip("Live · Anvil · r1")).toBeVisible();
        await expect(bar.deploy()).toBeVisible();
        await runConsoleLine(page, "remove receive");
        await expect(bar.chip("Modified since r1")).toBeVisible();
        await expect(bar.deployAgain()).toBeVisible();
      });
    });
  }
});
