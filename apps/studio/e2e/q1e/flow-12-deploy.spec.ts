/**
 * Flow 12. Deploy (spec L530-L580), against the test's Anvil node with wagmi's mock connector.
 *
 * Opening (step 1) and its disabled reasons, the review's nine sections (step 2), the missing contracts sub-step
 * through Arachnid's proxy (step 3), Sign & deploy through LatticeFactory and through CreateX to Live (steps 4-9),
 * tracking that resumes from the deployment record after a reload through Pending, Confirmed, Verify and Live, and a
 * Safe as deployer: the Transaction Builder batch records Proposed and the record confirms once the diamond appears.
 *
 * Each flow runs as written (pointer where the spec clicks) and again keyboard-only: after the page loads, the
 * keyboard variant never clicks.
 */
import type { Address, Hex } from "viem";
import { MULTICALL3, buildSalt } from "@lattice-studio/core";
import { ANVIL_CHAIN_ID, SAFE } from "../_support/anvil.ts";
import { catalog } from "../_support/catalog.ts";
import { focusRegion, focusedRegion, region } from "../_support/keys.ts";
import { recipeProject } from "../_support/projects.ts";
import { seedProject } from "../_support/seed.ts";
import { NARROW_WIDTHS, expectTier, tierAt, viewportAt } from "../_support/viewports.ts";
import { MOCK_ACCOUNT, shortAddress } from "../_support/wallet.ts";
import { executeAsSafe, mine, pendingDeploy, predictedAddress, recordFor, releaseAddress, removeShared, unstick } from "./pages/chain.ts";
import { expect, test } from "../_support/fixtures.ts";
import { DeployReview, MissingContractsDialog, REVIEW_SECTIONS, SafeBatchDialog, watchReactErrors } from "./pages/dialogs.ts";
import { activate, pressMod, runConsoleLine, runPalette, type InputMode } from "./pages/keys.ts";
import { ConsoleLog, Inspector, TitleBar, TitleBlock, expectAnnounced, expectDisabledWith } from "./pages/regions.ts";
import { connectOnAnvil } from "./pages/wallet.ts";

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

    test("⌘/Ctrl+Enter with blockers jumps to the first blocker, keyboard only", async ({ page }) => {
      await seedProject(page, { project: recipeProject("GovernedVault") });
      await expectDisabledWith(new TitleBlock(page).deploy(), "Resolve 1 blocker · F8");
      await focusRegion(page, "Sheet");
      await pressMod(page, "Enter");
      await expectAnnounced(page, "Asset is required. Fill it in before deploying.");
      // `problem.focus` (S4c) takes the person to the blocker: for a missing init argument (INIT-01), the argument's
      // own field in the inspector, marked invalid, where typing fixes it.
      await expect.poll(() => focusedRegion(page)).toBe("Inspector");
      const field = region(page, "Inspector").getByRole("textbox", { name: /asset/i });
      await expect(field).toBeFocused();
      await expect(field).toHaveAttribute("aria-invalid", "true");
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
        await review.expectOpen(crashed);
        for (const title of REVIEW_SECTIONS) await expect(review.section(title)).toBeVisible();
        // Spec L563's readiness line, for Anvil.
        await expect(review.section("Network")).toContainText("Anvil · LatticeFactory ✓ · 15 of 15 facets and init contracts ✓");
        await expect(review.section("What gets cut")).toContainText("14 facets · 120 selectors");
        const address = shortAddress(predictedAddress(recipeProject("GovernedVault", { filled: true })));
        await expect(review.section("Simulation")).toContainText(
          new RegExp(`Simulated at block [\\d,]+: diamond at ${address} with 14 facets, 120 selectors, \\d+ events\\.`),
        );
        const log = new ConsoleLog(page);
        await expect(log.line("Deploy", "Review: Anvil · LatticeFactory · 14 facets.")).toBeVisible();
        await expect(log.lineMatching("Deploy", /Simulated at block [\d,]+: succeeded, \d+ events\./)).toBeVisible();
        // Two acknowledgements wait: Cut without the registry check (NET-08) and Keep example values (INIT-05).
        await expectDisabledWith(review.sign(), "Tick the 2 acknowledgements first");
      });
    }
  });

  test.describe("step 3: missing contracts through Arachnid's proxy", () => {
    for (const mode of MODES) {
      test(`deploys what the chain lacks in one Multicall3 batch (${mode})`, async ({ page, anvil }) => {
        await removeShared(anvil, ["Receive", "EmergencyStop"]);
        await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
        await connectOnAnvil(page);
        const sentBefore = await anvil.client.getTransactionCount({ address: MOCK_ACCOUNT });
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

        // One transaction from the wallet, straight to Anvil, to Multicall3's aggregate3, and both contracts at their
        // release codehashes.
        expect(await anvil.client.getTransactionCount({ address: MOCK_ACCOUNT })).toBe(sentBefore + 1);
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
        const project = recipeProject("GovernedVault", { filled: true });
        await seedProject(page, { project: { ...project, deploy: { ...project.deploy, path } } });
        await connectOnAnvil(page);
        await runPalette(page, "Deploy…");
        const review = new DeployReview(page, "GovernedVault");
        await review.expectOpen(crashed);
        const address = (await review.section("Address").getByRole("definition").allTextContents()).find((text) => /^0x[0-9a-fA-F]{40}$/.test(text)) as Address;
        expect(address).toBeDefined();
        await expect(review.section("Address")).toContainText(`Free: no code at this address on Anvil.`);
        await expect(review.section("Simulation")).toContainText(
          new RegExp(`Simulated at block [\\d,]+: diamond at ${shortAddress(address)} with 14 facets, 120 selectors`),
        );
        // Sign & deploy enables once every acknowledgement is ticked (spec L573).
        await expect(review.sign()).toHaveAttribute("aria-disabled", "true");
        await review.tickAll(mode);
        await expect(review.sign()).not.toHaveAttribute("aria-disabled", "true");
        await activate(page, mode, review.sign());

        const log = new ConsoleLog(page);
        await expect(log.lineMatching("Deploy", /Submitted 0x[0-9a-f]{4}…[0-9a-f]{4} on Anvil\./)).toBeVisible();
        await expect(log.lineMatching("Deploy", new RegExp(`Deployed at ${shortAddress(address)} in block [\\d,]+\\. Matches the sheet\\.`))).toBeVisible();
        await expect(log.line("Verify", "Couldn't verify: Sourcify doesn't verify contracts on Anvil.")).toBeVisible();
        // The review follows the deploy to its end (spec L558) and the stamp goes Live (spec L580).
        await expect(review.root.getByRole("status")).toHaveText("Live · Anvil");
        await activate(page, mode, review.root.getByRole("button", { name: "Close", exact: true }));
        await expect(review.root).toBeHidden();
        await expect(new TitleBlock(page).stamp("Live · Anvil · r1")).toBeVisible();
        expect(await anvil.rpc<Hex>("eth_getCode", [address, "latest"])).not.toBe("0x");
        expect(await new TitleBlock(page).addressLine()).toEqual({ label: "Deployed", address });
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

        // The review's ticks are the person's consent however the deploy goes out, a Safe batch included (spec L573).
        const crashed = watchReactErrors(page);
        await runPalette(page, "Deploy…");
        const review = new DeployReview(page, "GovernedVault");
        await review.expectOpen(crashed);
        await review.tickAll(mode);
        if (mode === "pointer") await review.root.getByRole("button", { name: "Cancel", exact: true }).click();
        else await page.keyboard.press("Escape");
        await expect(review.root).toBeHidden();

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

    test("Discard proposal drops the record (spec L580), keyboard only", async ({ page, anvil }) => {
      void anvil;
      const project = recipeProject("GovernedVault", { filled: true });
      await seedProject(page, { project, deployments: [proposalFor(project)] });
      await runConsoleLine(page, "chain anvil");
      await runPalette(page, "Discard proposal");
      await expect(new ConsoleLog(page).line("Deploy", `Discarded the proposal to Safe ${shortAddress(SAFE)} on Anvil.`)).toBeVisible();
      await expect(new TitleBlock(page).stamp("Not deployed")).toBeVisible();
      await expect(new Inspector(page).deployments()).toContainText("Not deployed yet.");
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

