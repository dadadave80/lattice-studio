/**
 * Flow 14. Recover when something goes wrong (spec L586-L606): every row that can be forced on a local Anvil node,
 * with what the person sees and the way out.
 *
 * Forced here: the RPC down (Settings points Anvil at a port nothing listens on), offline before and during a
 * deploy, an address already used, Arachnid's proxy missing, CreateX's code wrong, a shared contract's code that
 * isn't Lattice's, a registry that doesn't list the pinned versions, a receipt that doesn't arrive in time and then
 * does, a diamond that doesn't match the sheet, Studio updated under the tab, a failed verification, and in the
 * review: a wallet on another chain, not enough funds, the gas cap (the node's simulation stubbed to report more
 * gas), a rejection in the wallet, a simulation that reverts, and the chain changing while the review is open.
 *
 * "No wallet in the browser" can't be forced: the e2e build always carries the mock connector.
 */
import type { Address, Hex } from "viem";
import { ARACHNID_PROXY, CREATEX } from "@lattice-studio/core";
import { localPort } from "../../local-env.ts";
import { ALICE, safeMockCode } from "../_support/anvil.ts";
import { focusRegion, region } from "../_support/keys.ts";
import { recipeProject } from "../_support/projects.ts";
import { seedProject, seedSettings } from "../_support/seed.ts";
import { shortAddress } from "../_support/wallet.ts";
import { deployOnAnvil, mine, pendingDeploy, predictedAddress, releaseAddress, removeShared } from "./pages/chain.ts";
import { DeployReview, SettingsDialog, watchReactErrors } from "./pages/dialogs.ts";
import { expect, test } from "./pages/fixtures.ts";
import { activate, pressMod, runConsoleLine, runPalette, runPaletteWith, tabTo, type InputMode } from "./pages/keys.ts";
import { ConsoleLog, Inspector, TitleBar, TitleBlock, expectAnnounced, expectDisabledWith } from "./pages/regions.ts";
import { connectOnAnvil, inflateSimulatedGas, rejectMockSends, routeMockSends } from "./pages/wallet.ts";

const MODES: readonly InputMode[] = ["pointer", "keyboard"];

/** "9,123,456": block numbers as the console writes them (spec L721). */
function grouped(value: bigint | number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** An RPC URL on this worktree's own loopback port that nothing listens on during e2e runs (Vitest's browser port). */
function deadRpc(): string {
  return `http://127.0.0.1:${localPort("VITEST_BROWSER_PORT")}`;
}

test.describe("Flow 14. Recover when something goes wrong", () => {
  test.describe("RPC down or rate-limited", () => {
    for (const mode of MODES) {
      test(`says Anvil's RPC isn't answering; Use another RPC… and Retry reading Anvil recover it (${mode})`, async ({ page, context, anvil }) => {
        await seedSettings(context, { rpc: { 31337: deadRpc() } });
        await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
        await runConsoleLine(page, "chain anvil");

        const readiness = new Inspector(page).readiness();
        await expect(readiness.getByRole("alert")).toHaveText("Couldn't read Anvil: the RPC didn't answer.");
        await expect(new ConsoleLog(page).line("Error", "Anvil's public RPC isn't answering.")).toBeVisible();
        const retry = readiness.getByRole("button", { name: "Retry reading Anvil", exact: true });
        const another = readiness.getByRole("button", { name: "Use another RPC…", exact: true });
        await expect(retry).toBeVisible();
        await expect(another).toBeVisible();

        // Use another RPC… opens Settings → Networks at the chain's override.
        if (mode === "pointer") await another.click();
        else await runPalette(page, "Use another RPC…");
        const settings = new SettingsDialog(page);
        await expect(settings.root.getByRole("tab", { name: "Networks", exact: true })).toHaveAttribute("aria-selected", "true");
        const field = settings.rpcOverride("Anvil");
        await expect(field).toHaveValue(deadRpc());
        if (mode === "pointer") {
          await field.fill(anvil.url);
        } else {
          await tabTo(page, field);
          await page.keyboard.press("End");
          for (let i = 0; i < deadRpc().length; i += 1) await page.keyboard.press("Backspace");
          await page.keyboard.type(anvil.url);
          await page.keyboard.press("Tab");
        }
        await expect(field).toHaveValue(anvil.url);
        if (mode === "pointer") await settings.close().click();
        else await page.keyboard.press("Escape");
        await expect(settings.root).toBeHidden();

        if (mode === "pointer" && (await retry.isVisible())) await retry.click();
        else if (await retry.isVisible()) await runPalette(page, "Retry reading Anvil");
        await expect(readiness.getByRole("alert")).toHaveCount(0);
        await expect(readiness).toContainText("14 of 14 on Anvil");
      });
    }
  });

  test.describe("Offline", () => {
    test("Deploy is disabled with \"Deploy needs a connection\" and ⌘/Ctrl+Enter only announces it, keyboard only @smoke", async ({ page, context }) => {
      await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
      const block = new TitleBlock(page);
      await expect(block.root).toContainText("14 facets · 120 selectors");
      await runConsoleLine(page, "chain anvil");
      await context.setOffline(true);
      // Spec L385 and L561 write it without a period.
      await expectDisabledWith(block.deploy(), "Deploy needs a connection");
      await expect(new Inspector(page).readiness()).toContainText("Chain checks need a connection.");
      await expect(region(page, "Console")).toContainText("Offline. Composing works; deploy needs a connection.");
      await focusRegion(page, "Sheet");
      await pressMod(page, "Enter");
      await expectAnnounced(page, "Deploy needs a connection");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await context.setOffline(false);
      await expect(block.deploy()).not.toHaveAttribute("aria-disabled", "true");
    });

    test("mid-deploy: \"Offline. Tracking resumes when you reconnect.\", then the receipt is recorded, keyboard only", async ({ page, context, anvil }) => {
      const project = recipeProject("GovernedVault", { filled: true });
      const record = await pendingDeploy(anvil, project);
      await seedProject(page, { project, deployments: [record] });
      await runConsoleLine(page, "chain anvil");
      const block = new TitleBlock(page);
      await expect(block.stamp(/^Pending · \d+:\d{2}$/)).toBeVisible();

      await context.setOffline(true);
      const log = new ConsoleLog(page);
      await expect(log.line("Deploy", "Offline. Tracking resumes when you reconnect.")).toBeVisible();
      await mine(anvil);
      await context.setOffline(false);
      const receipt = await anvil.client.getTransactionReceipt({ hash: record.tx as Hex });
      await expect(log.line("Deploy", `Deployed at ${shortAddress(record.address)} in block ${grouped(receipt.blockNumber)}. Matches the sheet.`)).toBeVisible();
      await expect(block.stamp("Live · Anvil · r1")).toBeVisible();
    });
  });

  test.describe("the chain isn't ready", () => {
    for (const mode of MODES) {
      test(`address already used (NET-05): Use a new salt moves the diamond to a free address (${mode})`, async ({ page, anvil }) => {
        const project = recipeProject("GovernedVault", { filled: true });
        const taken = await deployOnAnvil(anvil, project);
        await seedProject(page, { project });
        await connectOnAnvil(page);
        const log = new ConsoleLog(page);
        await expect(log.line("Note", "This account already deployed a diamond with this salt; deploying would return it and ignore this recipe.")).toBeVisible();
        const block = new TitleBlock(page);
        await expectDisabledWith(block.deploy(), "Resolve 1 blocker · F8");
        expect(await block.addressLine()).toEqual({ label: "Predicted", address: taken.address });

        await runPaletteWith(page, mode, "Use a new salt");
        await expect(log.lineMatching("Note", /Drew a new salt\./)).toBeVisible();
        await expect.poll(async () => (await block.addressLine())?.address).not.toBe(taken.address);
        const fresh = (await block.addressLine())?.address as `0x${string}`;
        expect(await anvil.rpc<Hex>("eth_getCode", [fresh, "latest"])).toBe("0x");
        await expect(block.deploy()).not.toHaveAttribute("aria-disabled", "true");
      });
    }

    test("Arachnid's proxy isn't on this chain (NET-02) when something needs deploying, keyboard only", async ({ page, anvil }) => {
      const crashed = watchReactErrors(page);
      await removeShared(anvil, ["Receive"]);
      await anvil.client.setCode({ address: ARACHNID_PROXY, bytecode: "0x" });
      await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
      await connectOnAnvil(page);
      const log = new ConsoleLog(page);
      await expect(log.line("Note", "Arachnid's deployment proxy isn't on Anvil, so missing contracts can't be deployed at their release addresses.")).toBeVisible();
      await expect(log.line("Note", "1 of 15 facets and init contracts aren't on Anvil yet. Anyone can deploy them at their release addresses.")).toBeVisible();
      await expectDisabledWith(new TitleBlock(page).deploy(), "Resolve 2 blockers · F8");

      // Way out: Choose another chain moves focus to the review's chain picker (IR L235).
      await runPalette(page, "Choose another chain");
      const review = new DeployReview(page, "GovernedVault");
      await review.expectOpen(crashed);
      await expect(review.section("Network").getByRole("combobox")).toBeFocused();
    });

    for (const mode of MODES) {
      test(`CreateX isn't CreateX on this chain (NET-01, CreateX path): Use LatticeFactory clears it (${mode})`, async ({ page, anvil }) => {
        await anvil.client.setCode({ address: CREATEX, bytecode: "0x6001600055" });
        const project = recipeProject("GovernedVault", { filled: true });
        await seedProject(page, { project: { ...project, deploy: { ...project.deploy, path: "createx" } } });
        await connectOnAnvil(page);
        const log = new ConsoleLog(page);
        await expect(log.line("Note", "The contract at CreateX's address on Anvil isn't CreateX: its codehash differs from 0xbd8a7ea8…b53f.")).toBeVisible();
        const block = new TitleBlock(page);
        await expectDisabledWith(block.deploy(), "Resolve 1 blocker · F8");

        // The title block's chain and path picker (spec L362): LatticeFactory is the path's other item.
        const picker = block.chainAndPath("Anvil · CreateX");
        const factory = page.getByRole("menuitemradio", { name: "LatticeFactory", exact: true });
        if (mode === "pointer") {
          await picker.click();
          await factory.click();
        } else {
          await focusRegion(page, "Sheet");
          await tabTo(page, picker);
          await page.keyboard.press("Enter");
          await expect(factory).toBeVisible();
          for (let i = 0; i < 10 && !(await factory.evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press("ArrowDown");
          await expect(factory).toBeFocused();
          await page.keyboard.press("Enter");
        }
        await expect(block.chainAndPath("Anvil · LatticeFactory")).toBeVisible();
        await expect(block.deploy()).not.toHaveAttribute("aria-disabled", "true");
        expect(await block.addressLine()).toEqual({ label: "Predicted", address: predictedAddress(project) });
      });
    }

    test("code at a shared contract's address isn't Lattice's (NET-04): a hard stop, keyboard only", async ({ page, anvil }) => {
      await anvil.client.setCode({ address: releaseAddress("Receive"), bytecode: "0x6001600055" });
      await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
      await connectOnAnvil(page);
      await expect(new ConsoleLog(page).lineMatching("Note", new RegExp(`The code at ${shortAddress(releaseAddress("Receive"))} isn't Lattice Receive \\d+\\.\\d+\\.\\d+\\.`))).toBeVisible();
      await expectDisabledWith(new TitleBlock(page).deploy(), "Resolve 1 blocker · F8");
    });

    test("a pinned registry version is missing (NET-08): a warning, so Deploy… stays enabled, keyboard only", async ({ page, anvil }) => {
      void anvil;
      await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
      await connectOnAnvil(page);
      await expect(new ConsoleLog(page).lineMatching("Note", /\d+ facets will be cut without the registry's on-chain check: Anvil's LatticeRegistry doesn't list their pinned versions\./)).toBeVisible();
      const block = new TitleBlock(page);
      await expect(block.root).toContainText("2 warnings");
      await expect(block.deploy()).not.toHaveAttribute("aria-disabled", "true");
    });
  });

  test.describe("tracking", () => {
    test("no receipt in time: \"Not seen for…\", Keep waiting, and a receipt that arrives later is still recorded, keyboard only", async ({ page, context, anvil }) => {
      const project = recipeProject("GovernedVault", { filled: true });
      const record = await pendingDeploy(anvil, project);
      await seedSettings(context, { receiptTimeout: 3 });
      await seedProject(page, { project, deployments: [record] });
      await runConsoleLine(page, "chain anvil");
      const log = new ConsoleLog(page);
      // Spec L575's "Not seen for 3 minutes." at the default 180 s; Settings → Deploy sets it to 3 s here.
      await expect(log.line("Deploy", "Not seen for 3 seconds. It may have been dropped.")).toBeVisible();

      await runPalette(page, "Keep waiting");
      await expect(log.line("Deploy", `Waiting for ${shortAddress(record.tx as string)} again.`)).toBeVisible();
      await expect(new TitleBlock(page).stamp(/^Pending · \d+:\d{2}$/)).toBeVisible();

      await mine(anvil);
      const receipt = await anvil.client.getTransactionReceipt({ hash: record.tx as Hex });
      await expect(log.line("Deploy", `Deployed at ${shortAddress(record.address)} in block ${grouped(receipt.blockNumber)}. Matches the sheet.`)).toBeVisible();
      await expect(new TitleBlock(page).stamp("Live · Anvil · r1")).toBeVisible();
    });

    test("Review again finds the first transaction landed after all and shows that diamond instead of sending a second, keyboard only", async ({ page, context, anvil }) => {
      const project = recipeProject("GovernedVault", { filled: true });
      const record = await pendingDeploy(anvil, project);
      await seedSettings(context, { receiptTimeout: 3 });
      await seedProject(page, { project, deployments: [record] });
      await runConsoleLine(page, "chain anvil");
      const log = new ConsoleLog(page);
      await expect(log.line("Deploy", "Not seen for 3 seconds. It may have been dropped.")).toBeVisible();

      await mine(anvil);
      const sent = await anvil.client.getTransactionCount({ address: ALICE });
      await runPalette(page, "Review again");
      await expect(log.line("Deploy", `The first transaction landed after all: the diamond is at ${shortAddress(record.address)} on Anvil.`)).toBeVisible();
      await expect(new TitleBlock(page).stamp("Live · Anvil · r1")).toBeVisible();
      expect(await anvil.client.getTransactionCount({ address: ALICE })).toBe(sent);
    });

    for (const mode of MODES) {
      test(`deployed, but it doesn't match the sheet: saved as Mismatch, never Live; Compare with the sheet… (${mode})`, async ({ page, anvil }) => {
        const project = recipeProject("GovernedVault", { filled: true });
        // An older transaction with the same account and salt deploys another recipe at the predicted address.
        const record = await pendingDeploy(anvil, project, { onChain: recipeProject("ERC20", { filled: true }) });
        await seedProject(page, { project, deployments: [record] });
        await runConsoleLine(page, "chain anvil");
        await mine(anvil);

        const log = new ConsoleLog(page);
        // Spec L725; the backticks around facets() are code formatting, not part of the line's accessible name.
        await expect(log.lineMatching("Deploy", new RegExp(`Deployed at ${shortAddress(record.address)}, but facets\\(\\) doesn't match the sheet: \\d+ selectors differ\\.`))).toBeVisible();
        const block = new TitleBlock(page);
        const bar = new TitleBar(page);
        await expect(block.stamp("Mismatch · Anvil")).toBeVisible();
        await expect(bar.chip("Mismatch · Anvil")).toBeVisible();
        await expect(block.stamp("Live · Anvil · r1")).toHaveCount(0);
        await expect(new Inspector(page).deploymentsOn("Anvil")).toContainText("Mismatch");

        await activate(page, mode, block.compare());
        const inspector = new Inspector(page);
        await expect(inspector.root.getByRole("heading", { name: "Compare with the sheet", exact: true })).toBeVisible();
        // Flow 12 step 7 (spec L576).
        await expect(inspector.root.getByRole("status")).toHaveText("Deployed, but doesn't match the sheet");
        await expect(inspector.root.getByRole("button", { name: "Use a new salt", exact: true })).toBeVisible();
      });
    }
  });

  test("Studio updated while this tab needed a new piece of it: \"Save and reload\" gets it back", async ({ page }) => {
    await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
    await expect(new TitleBlock(page).root).toContainText("14 facets · 120 selectors");
    // The deploy review's chunk is gone from the server, as after a release.
    const gone = (route: import("@playwright/test").Route) => route.abort();
    await page.route("**/assets/**", gone);
    await runPalette(page, "Deploy…");
    await expect(page.getByText("Studio was updated. Save and reload to continue.", { exact: true })).toBeVisible();
    await page.unroute("**/assets/**", gone);
    await page.getByRole("button", { name: "Save and reload", exact: true }).click();
    await expect(page).toHaveTitle(/^GovernedVault · /);
    await expect(page.getByText("Studio was updated. Save and reload to continue.", { exact: true })).toHaveCount(0);
  });

  for (const mode of MODES) {
    test(`verification failed: the reason, and Retry verification runs it again (${mode})`, async ({ page, anvil }) => {
      const project = recipeProject("GovernedVault", { filled: true });
      const live = await deployOnAnvil(anvil, project);
      await seedProject(page, { project, deployments: [live] });
      await runConsoleLine(page, "chain anvil");
      const list = new Inspector(page).deploymentsOn("Anvil");
      await expect(list).toContainText("Couldn't verify");
      const log = new ConsoleLog(page);
      const line = log.line("Verify", "Couldn't verify: Sourcify doesn't verify contracts on Anvil.");
      const before = await line.count();
      const retry = list.getByRole("button", { name: "Retry verification", exact: true });
      if (mode === "keyboard") await focusRegion(page, "Inspector");
      await activate(page, mode, retry);
      await expect(line).toHaveCount(before + 1);
    });
  }

  test.describe("rows the review shows", () => {
    test("wallet on another chain: \"Your wallet is on Sepolia.\" with Switch network, which clears it, keyboard only", async ({ page, anvil }) => {
      void anvil;
      const crashed = watchReactErrors(page);
      await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
      await runConsoleLine(page, "chain anvil");
      // The mock connector starts on Sepolia, the picker's first chain.
      await runPalette(page, "Connect wallet");
      await expect(new ConsoleLog(page).lineMatching("Note", /Connected 0xf39F…2266 through Mock Connector\./)).toBeVisible();
      await runPalette(page, "Deploy…");
      const review = new DeployReview(page, "GovernedVault");
      await review.expectOpen(crashed);
      const deployer = review.section("Deployer");
      await expect(deployer).toContainText("Your wallet is on Sepolia.");
      await expect(deployer).toHaveAccessibleDescription("Blocks deploy");
      const switchNetwork = deployer.getByRole("button", { name: "Switch network", exact: true });
      await activate(page, "keyboard", switchNetwork);
      await expect(deployer).not.toContainText("Your wallet is on Sepolia.");
      await expect(deployer).toHaveAccessibleDescription("Ready");
    });

    test("not enough funds: \"Needs about … ETH; this account has ….\", keyboard only", async ({ page, anvil }) => {
      const crashed = watchReactErrors(page);
      await anvil.client.setBalance({ address: ALICE, value: 1_000_000_000_000n });
      await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
      await connectOnAnvil(page);
      await runPalette(page, "Deploy…");
      const review = new DeployReview(page, "GovernedVault");
      await review.expectOpen(crashed);
      const needs = /^Needs about [\d.]+ ETH; this account has 0\.000001\.$/;
      await expect(review.section("Deployer").getByText(needs)).toBeVisible();
      await expect(review.section("Deployer")).toHaveAccessibleDescription("Blocks deploy");
      await review.tickAll("keyboard");
      await expect(review.sign()).toHaveAttribute("aria-disabled", "true");
      await expect(review.sign()).toHaveAccessibleDescription(needs);
    });

    for (const { gas, severity, words } of [
      { gas: 26_000_000n, severity: "warning", words: "Warning" },
      { gas: 31_000_000n, severity: "blocker", words: "Blocker" },
    ]) {
      test(`over the gas cap (NET-06, a ${severity}) with the estimate; Remove facets… opens the checklist, keyboard only`, async ({ page, anvil }) => {
        const crashed = watchReactErrors(page);
        // Anvil's per-transaction cap is 30M in Studio's chain table; the node's simulation reports `gas` used.
        await inflateSimulatedGas(page, anvil.url, gas);
        await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
        await connectOnAnvil(page);
        await runPalette(page, "Deploy…");
        const review = new DeployReview(page, "GovernedVault");
        await review.expectOpen(crashed);
        const cost = review.section("Cost");
        const millions = Number(gas / 1_000_000n);
        await expect(cost).toContainText(`This deploy needs about ${millions}M gas; Anvil allows 30M per transaction.`);
        await expect(cost.getByRole("img", { name: words, exact: true })).toBeVisible();
        await expect(cost).toContainText(`${Math.round((millions / 30) * 100)}% of Anvil's 30M per-transaction cap`);
        if (severity === "blocker") {
          await expect(cost).toHaveAccessibleDescription("Blocks deploy");
          await expectDisabledWith(review.sign(), "Resolve 1 blocker · F8");
        }
        await activate(page, "keyboard", cost.getByRole("button", { name: "Remove facets…", exact: true }));
        await expect(page.getByRole("dialog", { name: "Remove facets", exact: true })).toBeVisible();
      });
    }

    test("rejected in the wallet: \"You canceled in your wallet.\" and Sign again, keyboard only", async ({ page, anvil }) => {
      const crashed = watchReactErrors(page);
      await routeMockSends(page, anvil.url);
      const rejected = await rejectMockSends(page);
      await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
      await connectOnAnvil(page);
      await runPalette(page, "Deploy…");
      const review = new DeployReview(page, "GovernedVault");
      await review.expectOpen(crashed);
      await review.tickAll("keyboard");
      await activate(page, "keyboard", review.sign());
      await expect(new ConsoleLog(page).line("Deploy", "You canceled in your wallet.")).toBeVisible();
      await expect(review.root.getByRole("button", { name: "Sign again", exact: true })).toBeVisible();
      expect(rejected()).toBe(1);
      expect(await anvil.rpc<Hex>("eth_getCode", [predictedAddress(recipeProject("GovernedVault", { filled: true })), "latest"])).toBe("0x");
    });

    test("after a rejection the review says so and Sign again asks the wallet again (spec L574)", async ({ page, anvil }) => {
      test.fail(
        true,
        "After the wallet rejects, the review re-simulates and stays at \"Simulating…\" with Sign again disabled, and \"You canceled in your wallet.\" shows only in the log, not in the review (spec L574) · follow-up for S8b/S8c from Q1e",
      );
      const crashed = watchReactErrors(page);
      await routeMockSends(page, anvil.url);
      await rejectMockSends(page);
      await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
      await connectOnAnvil(page);
      await runPalette(page, "Deploy…");
      const review = new DeployReview(page, "GovernedVault");
      await review.expectOpen(crashed);
      await review.tickAll("pointer");
      await review.sign().click();
      await expect(review.root).toContainText("You canceled in your wallet.", { timeout: 10_000 });
      await expect(review.root.getByRole("button", { name: "Sign again", exact: true })).not.toHaveAttribute("aria-disabled", "true", { timeout: 10_000 });
    });

    test("simulation reverts: the decoded error and the module it came from, with Copy details, keyboard only", async ({ page, context, anvil }) => {
      const crashed = watchReactErrors(page);
      // SafeDiamondCut's init checks the Safe's threshold on-chain: a Safe with threshold 1 against the recipe's
      // minimum of 2 passes every check Studio runs before the simulation, then reverts.
      const project = recipeProject("SafeDiamondCut", { filled: true });
      const init = project.recipe.init;
      const safe = (init.kind === "steps" ? init.steps[0]?.args["safe"] : undefined) as Address;
      await anvil.client.setCode({ address: safe, bytecode: safeMockCode(1) });
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await seedProject(page, { project });
      await connectOnAnvil(page);
      await runPalette(page, "Deploy…");
      const review = new DeployReview(page, project.name);
      await review.expectOpen(crashed);
      const simulation = review.section("Simulation");
      // Spec L572, L727: "Deploy reverted in {module}: {error}({decoded args})."
      await expect(simulation).toContainText("Deploy reverted in SafeDiamondCut: `SafeDiamondCutThresholdTooLow(1, 2)`.");
      await expect(simulation).toHaveAccessibleDescription("Blocks deploy");
      await expect(new ConsoleLog(page).line("Error", "Deploy reverted in SafeDiamondCut: SafeDiamondCutThresholdTooLow(1, 2).")).toBeVisible();
      await expect(review.sign()).toHaveAttribute("aria-disabled", "true");
      await activate(page, "keyboard", simulation.getByRole("button", { name: "Copy details", exact: true }));
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("SafeDiamondCutThresholdTooLow");
    });

    for (const mode of MODES) {
      test(`the chain changes during review: "Changed since review. Simulating again." (${mode})`, async ({ page, anvil }) => {
        void anvil;
        const crashed = watchReactErrors(page);
        await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
        await connectOnAnvil(page);
        await runPalette(page, "Deploy…");
        const review = new DeployReview(page, "GovernedVault");
        await review.expectOpen(crashed);
        await expect(review.section("Simulation")).toContainText(/Simulated at block/);
        await expect(review.root.getByText("Changed since review. Simulating again.", { exact: true })).toHaveCount(0);

        const chain = review.section("Network").getByRole("combobox", { name: "Chain", exact: true });
        const sepolia = page.getByRole("option", { name: "Sepolia", exact: true });
        if (mode === "pointer") {
          await chain.click();
          await sepolia.click();
        } else {
          await activate(page, "keyboard", chain);
          await expect(sepolia).toBeVisible();
          for (let i = 0; i < 5 && !(await sepolia.evaluate((el) => el === document.activeElement || el.getAttribute("data-highlighted") !== null)); i += 1) {
            await page.keyboard.press("ArrowUp");
          }
          await page.keyboard.press("Enter");
        }
        await expect(chain).toHaveText("Sepolia");
        await expect(review.root.getByRole("status").filter({ hasText: "Changed since review. Simulating again." })).toBeVisible();
        // The wallet stayed on Anvil: the review says so where it offers the way back (Flow 14).
        await expect(review.root).toContainText("Your wallet is on Anvil.");
        await expect(review.root.getByRole("button", { name: "Switch network", exact: true })).toBeVisible();
      });
    }
  });
});
