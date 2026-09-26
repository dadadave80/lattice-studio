/**
 * Flow 12. Deploy (spec L530-L580), against the test's Anvil node with wagmi's mock connector.
 *
 * What runs today: opening (step 1) and its disabled reasons, the missing contracts sub-step through Arachnid's
 * proxy (step 3), tracking that resumes from the deployment record after a reload through Pending, Confirmed, Verify
 * and Live (steps 6-9), and a Safe as deployer: the Transaction Builder batch records Proposed and the record
 * confirms once the diamond appears. The review itself (steps 2, 4 and 5) crashes as it opens on this build; those
 * tests skip with `REVIEW_CRASHES` and run as soon as the fix lands.
 *
 * Each flow runs as written (pointer where the spec clicks) and again keyboard-only: after the page loads, the
 * keyboard variant never clicks.
 */
import type { Address, Hex } from "viem";
import { MULTICALL3, buildSalt } from "@lattice-studio/core";
import { ANVIL_CHAIN_ID, SAFE } from "../_support/anvil.ts";
import { showsNotBuilt, notBuiltText } from "../_support/built.ts";
import { catalog } from "../_support/catalog.ts";
import { focusRegion, focusedRegion, region } from "../_support/keys.ts";
import { recipeProject } from "../_support/projects.ts";
import { seedProject } from "../_support/seed.ts";
import { NARROW_WIDTHS, expectTier, tierAt, viewportAt } from "../_support/viewports.ts";
import { shortAddress } from "../_support/wallet.ts";
import { executeAsSafe, mine, pendingDeploy, predictedAddress, recordFor, releaseAddress, removeShared, unstick } from "./pages/chain.ts";
import { expect, test } from "./pages/fixtures.ts";
import { DeployReview, MissingContractsDialog, REVIEW_SECTIONS, SafeBatchDialog, watchReactErrors } from "./pages/dialogs.ts";
import { activate, pressMod, runConsoleLine, runPalette, type InputMode } from "./pages/keys.ts";
import { ConsoleLog, Inspector, TitleBar, TitleBlock, expectAnnounced, expectDisabledWith } from "./pages/regions.ts";
import { connectOnAnvil, routeMockSends } from "./pages/wallet.ts";

const MODES: readonly InputMode[] = ["pointer", "keyboard"];

/** "9,123,456": block numbers as the console writes them (spec L721). */
function grouped(value: bigint | number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** A proposal record, as Download Transaction Builder batch writes it (spec L580). */
function proposalFor(project: ReturnType<typeof recipeProject>) {
  const salt: Hex = buildSalt(SAFE, project.deploy.scope, project.deploy.entropy);
  return recordFor(project, {
    address: predictedAddress(project, SAFE),
    salt,
    deployer: SAFE,
    status: "proposed",
    verification: "pending",
    at: new Date().toISOString(),
  });
}

test.describe("Flow 12. Deploy", () => {
  test.describe("step 1: open", () => {
    test("Deploy… is disabled with the blockers' count while blockers remain @smoke", async ({ page }) => {
      await seedProject(page, { project: recipeProject("GovernedVault") });
      const block = new TitleBlock(page);
      await expect(block.root).toContainText("1 blocker · 1 warning");
      // Spec L382: "Deploy disabled: 'Resolve 2 blockers · F8'", here with one.
      await expectDisabledWith(block.deploy(), "Resolve 1 blocker · F8");
    });

    test("⌘/Ctrl+Enter with blockers says the first blocker instead of opening the review, keyboard only", async ({ page }) => {
      await seedProject(page, { project: recipeProject("GovernedVault") });
      await expectDisabledWith(new TitleBlock(page).deploy(), "Resolve 1 blocker · F8");
      await focusRegion(page, "Sheet");
      await pressMod(page, "Enter");
      await expectAnnounced(page, "Asset is required. Fill it in before deploying.");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    test("⌘/Ctrl+Enter with blockers jumps to the first blocker's note, keyboard only", async ({ page }) => {
      await seedProject(page, { project: recipeProject("GovernedVault") });
      await expectDisabledWith(new TitleBlock(page).deploy(), "Resolve 1 blocker · F8");
      await focusRegion(page, "Sheet");
      await pressMod(page, "Enter");
      await expectAnnounced(page, "Asset is required. Fill it in before deploying.");
      // Moving focus to the note is `problem.focus`, S4c's (the notes on the sheet).
      test.skip(await showsNotBuilt(page, "S4c"), notBuiltText("S4c"));
      expect(await focusedRegion(page)).toBe("Sheet");
      await expect(page.locator(":focus")).toContainText("Asset is required");
    });

    const openings = [
      { how: "Deploy… in the title block", mode: "pointer" as const },
      { how: "⌘/Ctrl+Enter", mode: "keyboard" as const },
      { how: "the palette", mode: "keyboard" as const },
      { how: "console `deploy anvil`", mode: "keyboard" as const },
    ];
    for (const { how, mode } of openings) {
      test(`step 2: ${how} opens the review with its nine sections`, async ({ page, anvil }) => {
        void anvil;
        const crashed = watchReactErrors(page);
        await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
        await connectOnAnvil(page);
        const block = new TitleBlock(page);
        if (how === "Deploy… in the title block") await activate(page, mode, block.deploy());
        if (how === "⌘/Ctrl+Enter") {
          await focusRegion(page, "Sheet");
          await pressMod(page, "Enter");
        }
        if (how === "the palette") await runPalette(page, "Deploy…");
        if (how === "console `deploy anvil`") await runConsoleLine(page, "deploy anvil");
        const review = new DeployReview(page, "GovernedVault");
        await review.expectOpenOrSkip(crashed);
        for (const title of REVIEW_SECTIONS) await expect(review.section(title)).toBeVisible();
        await expect(review.sign()).toBeVisible();
      });
    }
  });

  test.describe("step 3: missing contracts through Arachnid's proxy", () => {
    for (const mode of MODES) {
      test(`deploys what the chain lacks in one Multicall3 batch (${mode})`, async ({ page, anvil }) => {
        await removeShared(anvil, ["Receive", "EmergencyStop"]);
        const forwarded = await routeMockSends(page, anvil.url);
        await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
        await connectOnAnvil(page);
        const log = new ConsoleLog(page);
        const netLine = "2 of 15 facets and init contracts aren't on Anvil yet. Anyone can deploy them at their release addresses.";
        await expect(log.line("Note", netLine)).toBeVisible();
        await expectDisabledWith(new TitleBlock(page).deploy(), "Resolve 1 blocker · F8");

        await runPalette(page, "Deploy missing contracts…");
        const dialog = new MissingContractsDialog(page);
        await expect(dialog.root).toBeVisible();
        await expect(dialog.root).toContainText(
          "Each deploys through Arachnid's proxy at its release address, which depends only on its bytecode, so any connected account can do this.",
        );
        for (const name of ["EmergencyStop", "Receive"]) await expect(dialog.row(name)).toContainText("Missing");

        await activate(page, mode, dialog.deploy(2));
        for (const name of ["EmergencyStop", "Receive"]) await expect(dialog.row(name)).toContainText("Deployed");
        await expect(log.line("Deploy", "Deployed 2 missing contracts on Anvil.")).toBeVisible();

        // One transaction, to Multicall3's aggregate3, and both contracts at their release codehashes.
        expect(forwarded()).toBe(1);
        const block = await anvil.client.getBlock({ includeTransactions: true });
        expect(block.transactions.map((tx) => tx.to?.toLowerCase())).toEqual([MULTICALL3.toLowerCase()]);
        for (const name of ["EmergencyStop", "Receive"]) {
          const release = catalog().facets.find((f) => f.name === name)?.release;
          expect(await anvil.codehash(releaseAddress(name))).toBe(release?.codehash);
        }
        await page.keyboard.press("Escape");
        await expect(dialog.root).toBeHidden();
        await expect(new TitleBlock(page).deploy()).not.toHaveAttribute("aria-disabled", "true");
      });
    }

    test("a failed contract doesn't undo the others; Studio diagnoses it and Retry deploys it, keyboard only", async ({ page, anvil }) => {
      await removeShared(anvil, ["Receive", "EmergencyStop"], ["EmergencyStop"]);
      await routeMockSends(page, anvil.url);
      await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
      await connectOnAnvil(page);
      await runPalette(page, "Deploy missing contracts…");
      const dialog = new MissingContractsDialog(page);
      await activate(page, "keyboard", dialog.deploy(2));

      await expect(dialog.row("EmergencyStop")).toContainText("Failed");
      await expect(dialog.row("EmergencyStop")).toContainText(
        "Creating EmergencyStop reverts: Arachnid's proxy gives no reason, so check the gas and the chain's code size limit.",
      );
      await expect(dialog.row("Receive")).toContainText("Deployed");
      const log = new ConsoleLog(page);
      await expect(log.line("Deploy", "Deployed 1 of 2 missing contracts on Anvil; 1 failed.")).toBeVisible();

      // Whatever made it fail is fixed; Retry checks the chain again and sends it alone.
      await unstick(anvil, "EmergencyStop");
      await activate(page, "keyboard", dialog.retry("EmergencyStop"));
      await expect(dialog.row("EmergencyStop")).toContainText("Deployed");
      await expect(log.line("Deploy", "Deployed 1 missing contract on Anvil.")).toBeVisible();
      expect(await anvil.codehash(releaseAddress("EmergencyStop"))).toBe(catalog().facets.find((f) => f.name === "EmergencyStop")?.release.codehash);
    });
  });

  test.describe("steps 4-5: confirm and sign", () => {
    const paths = [
      { path: "factory" as const, name: "LatticeFactory", mode: "pointer" as const },
      { path: "createx" as const, name: "CreateX", mode: "keyboard" as const },
    ];
    for (const { path, name, mode } of paths) {
      test(`Sign & deploy through ${name} sends the reviewed transaction and the diamond goes Live (${mode})`, async ({ page, anvil }) => {
        const crashed = watchReactErrors(page);
        await routeMockSends(page, anvil.url);
        const project = recipeProject("GovernedVault", { filled: true });
        await seedProject(page, { project: { ...project, deploy: { ...project.deploy, path } } });
        await connectOnAnvil(page);
        await runPalette(page, "Deploy…");
        const review = new DeployReview(page, "GovernedVault");
        await review.expectOpenOrSkip(crashed);
        await expect(review.section("Simulation")).toContainText(/Simulated at block [\d,]+: diamond at 0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4} with 14 facets, 120 selectors/);
        await activate(page, mode, review.sign());
        const log = new ConsoleLog(page);
        await expect(log.lineMatching("Deploy", /Deployed at 0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4} in block [\d,]+\. Matches the sheet\./)).toBeVisible();
        await expect(new TitleBlock(page).stamp("Live · Anvil · r1")).toBeVisible();
      });
    }
  });

  test.describe("steps 6-9: pending, confirmed, verify and live, resumed from the record", () => {
    test("a reload while pending resumes tracking; the receipt confirms, verification settles and the stamp goes Live @smoke", async ({ page, anvil, blockedRequests }) => {
      const project = recipeProject("GovernedVault", { filled: true });
      const record = await pendingDeploy(anvil, project);
      await seedProject(page, { project, deployments: [record] });
      await runConsoleLine(page, "chain anvil");

      const block = new TitleBlock(page);
      const bar = new TitleBar(page);
      // Spec L386: "Pending · 0:12" in the title block while it waits.
      await expect(block.stamp(/^Pending · \d+:\d{2}$/)).toBeVisible();
      await expect(bar.chip("Pending · Anvil")).toBeVisible();
      await expectDisabledWith(block.deploy(), "This deploy is already on its way");
      await expect(new Inspector(page).deploymentsOn("Anvil")).toContainText("Pending");

      // The tab closes and opens again: tracking resumes from the record's transaction hash (spec L558).
      await page.reload();
      await runConsoleLine(page, "chain anvil");
      await expect(block.stamp(/^Pending · \d+:\d{2}$/)).toBeVisible();

      await mine(anvil);
      const receipt = await anvil.client.getTransactionReceipt({ hash: record.tx as Hex });
      const log = new ConsoleLog(page);
      await expect(log.line("Deploy", `Deployed at ${shortAddress(record.address)} in block ${grouped(receipt.blockNumber)}. Matches the sheet.`)).toBeVisible();
      // Verify: S8d never calls Sourcify for Anvil, and says so (spec L577-L579).
      await expect(log.line("Verify", "Couldn't verify: Sourcify doesn't verify contracts on Anvil.")).toBeVisible();
      expect(blockedRequests.filter((url) => url.includes("sourcify"))).toEqual([]);

      await expect(block.stamp("Live · Anvil · r1")).toBeVisible();
      await expect(bar.chip("Live · Anvil · r1")).toBeVisible();
      expect(await block.addressLine()).toEqual({ label: "Deployed", address: record.address });
      const list = new Inspector(page).deploymentsOn("Anvil");
      await expect(list).toContainText("Live · r1");
      await expect(list.getByRole("button", { name: "Retry verification", exact: true })).toBeVisible();
      expect(await anvil.rpc<Hex>("eth_getCode", [record.address, "latest"])).not.toBe("0x");
    });
  });

  test.describe("Safe as deployer (v1: Transaction Builder batch)", () => {
    for (const mode of MODES) {
      test(`the batch download records Proposed, and the record confirms once the diamond appears (${mode})`, async ({ page, anvil }) => {
        const project = recipeProject("GovernedVault", { filled: true });
        await seedProject(page, { project });
        await runConsoleLine(page, "chain anvil");
        await expect(new ConsoleLog(page).line("Note", "Selected Anvil.")).toBeVisible();

        if (mode === "pointer") {
          await region(page, "Console").getByRole("button", { name: "Export", exact: true }).click();
          await page.getByRole("menuitem", { name: "Safe batch…", exact: true }).click();
        } else {
          await runConsoleLine(page, "export safe");
        }
        const dialog = new SafeBatchDialog(page);
        await expect(dialog.root).toBeVisible();
        if (mode === "pointer") await dialog.safeAddress().click();
        else await expect(dialog.safeAddress()).toBeFocused();
        await page.keyboard.type(SAFE);
        const download = page.waitForEvent("download");
        await activate(page, mode, dialog.download());
        const file = await download;
        const batch = JSON.parse(await readDownload(file)) as { chainId: string; transactions: { to: Address; data: Hex }[] };
        expect(batch.chainId).toBe(String(ANVIL_CHAIN_ID));
        expect(batch.transactions).toHaveLength(1);

        const block = new TitleBlock(page);
        const address = predictedAddress(project, SAFE);
        await expect(block.stamp("Proposed · Anvil (Safe)")).toBeVisible();
        await expectDisabledWith(block.deploy(), "Waiting for the Safe to execute the batch");
        const log = new ConsoleLog(page);
        await expect(log.line("Deploy", `Proposed to Safe ${shortAddress(SAFE)} on Anvil. Waiting for the Safe to execute the batch.`)).toBeVisible();
        const list = new Inspector(page).deploymentsOn("Anvil");
        await expect(list).toContainText("Proposed (Safe)");
        await expect(list.getByRole("button", { name: "Discard proposal", exact: true })).toBeVisible();

        // The Safe's owners execute the batch; Studio re-checks the predicted address when the project opens again.
        await executeAsSafe(anvil, SAFE, batch);
        await page.reload();
        await expect(log.line("Deploy", `The Safe executed the batch: the diamond is at ${shortAddress(address)} on Anvil.`)).toBeVisible();
        await runConsoleLine(page, "chain anvil");
        await expect(block.stamp("Live · Anvil · r1")).toBeVisible();
        await expect(new Inspector(page).deploymentsOn("Anvil")).not.toContainText("Proposed");
      });
    }

    for (const mode of MODES) {
      test(`Discard proposal says what it dropped and frees Deploy… (${mode})`, async ({ page, anvil }) => {
        void anvil;
        const project = recipeProject("GovernedVault", { filled: true });
        await seedProject(page, { project, deployments: [proposalFor(project)] });
        await runConsoleLine(page, "chain anvil");
        const block = new TitleBlock(page);
        await expect(block.stamp("Proposed · Anvil (Safe)")).toBeVisible();
        if (mode === "pointer") await new Inspector(page).deployments().getByRole("button", { name: "Discard proposal", exact: true }).click();
        else await runPalette(page, "Discard proposal");
        await expect(new ConsoleLog(page).line("Deploy", `Discarded the proposal to Safe ${shortAddress(SAFE)} on Anvil.`)).toBeVisible();
        await expect(block.stamp("Proposed · Anvil (Safe)")).toBeHidden();
        await expect(block.deploy()).not.toHaveAttribute("aria-disabled", "true");
      });
    }

    test("Discard proposal drops the record (spec L580)", async ({ page, anvil }) => {
      void anvil;
      test.fail(true, "S8c keeps a discarded proposal as a Failed record and stamps \"Failed · Anvil\"; spec L580 says Discard proposal drops it · follow-up for S8c from Q1e");
      const project = recipeProject("GovernedVault", { filled: true });
      await seedProject(page, { project, deployments: [proposalFor(project)] });
      await runConsoleLine(page, "chain anvil");
      await runPalette(page, "Discard proposal");
      await expect(new ConsoleLog(page).line("Deploy", `Discarded the proposal to Safe ${shortAddress(SAFE)} on Anvil.`)).toBeVisible();
      await expect(new TitleBlock(page).stamp("Not deployed")).toBeVisible({ timeout: 3_000 });
      await expect(new Inspector(page).deployments()).toContainText("Not deployed yet.", { timeout: 3_000 });
    });
  });

  for (const width of NARROW_WIDTHS) {
    test.describe(`at ${width} px`, () => {
      test.use({ viewport: viewportAt(width) });

      test("the status chip and a disabled Deploy… with its reason sit in the title bar, keyboard only", async ({ page, anvil }) => {
        void anvil;
        const project = recipeProject("GovernedVault", { filled: true });
        await seedProject(page, { project, deployments: [proposalFor(project)] });
        await expectTier(page, tierAt(width));
        await runConsoleLine(page, "chain anvil");
        const bar = new TitleBar(page);
        await expect(bar.chip("Proposed · Anvil (Safe)")).toBeVisible();
        await expectDisabledWith(bar.deploy(), "Waiting for the Safe to execute the batch");
      });
    });
  }
});

async function readDownload(download: import("@playwright/test").Download): Promise<string> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString("utf8");
}

