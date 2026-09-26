/**
 * Flow 14. Recover when something goes wrong (spec L586-L606): every row that can be forced on a local Anvil node,
 * with what the person sees and the way out.
 *
 * Forced here: the RPC down (Settings points Anvil at a port nothing listens on), offline before and during a
 * deploy, an address already used, Arachnid's proxy missing, CreateX's code wrong, a shared contract's code that
 * isn't Lattice's, a registry that doesn't list the pinned versions, a receipt that doesn't arrive in time and then
 * does, a diamond that doesn't match the sheet, Studio updated under the tab, and a failed verification.
 *
 * The rows the review shows (a wallet on another chain, not enough funds, the gas cap, a rejection in the wallet)
 * need the review, which crashes as it opens on this build: they skip with `REVIEW_CRASHES`. "No wallet in the
 * browser" can't be forced: the e2e build always carries the mock connector.
 */
import type { Hex } from "viem";
import { ARACHNID_PROXY, CREATEX } from "@lattice-studio/core";
import { localPort } from "../../local-env.ts";
import { ALICE } from "../_support/anvil.ts";
import { focusRegion, region } from "../_support/keys.ts";
import { recipeProject } from "../_support/projects.ts";
import { seedProject, seedSettings } from "../_support/seed.ts";
import { shortAddress } from "../_support/wallet.ts";
import { deployOnAnvil, mine, pendingDeploy, predictedAddress, releaseAddress, removeShared } from "./pages/chain.ts";
import { DeployReview, SettingsDialog, watchReactErrors } from "./pages/dialogs.ts";
import { expect, test } from "./pages/fixtures.ts";
import { activate, pressMod, runConsoleLine, runPalette, runPaletteWith, tabTo, type InputMode } from "./pages/keys.ts";
import { ConsoleLog, Inspector, TitleBar, TitleBlock, expectAnnounced, expectDisabledWith } from "./pages/regions.ts";
import { connectOnAnvil } from "./pages/wallet.ts";

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
      await review.expectOpenOrSkip(crashed);
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
    test("wallet on another chain: \"Your wallet is on Sepolia.\" with Switch network", async ({ page, anvil }) => {
      void anvil;
      const crashed = watchReactErrors(page);
      await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
      await runConsoleLine(page, "chain anvil");
      // The mock connector starts on Sepolia, the picker's first chain.
      await runPalette(page, "Connect wallet");
      await runPalette(page, "Deploy…");
      const review = new DeployReview(page, "GovernedVault");
      await review.expectOpenOrSkip(crashed);
      await expect(review.section("Deployer")).toContainText("Your wallet is on Sepolia.");
      await expect(review.section("Deployer").getByRole("button", { name: "Switch network", exact: true })).toBeVisible();
    });

    test("not enough funds: \"Needs about … ETH; this account has ….\"", async ({ page, anvil }) => {
      const crashed = watchReactErrors(page);
      await anvil.client.setBalance({ address: ALICE, value: 1_000n });
      await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
      await connectOnAnvil(page);
      await runPalette(page, "Deploy…");
      const review = new DeployReview(page, "GovernedVault");
      await review.expectOpenOrSkip(crashed);
      await expect(review.root).toContainText(/Needs about [\d.,]+ ETH; this account has [\d.,<]+\./);
    });

    test("over the gas cap (NET-06) with the estimate, and Remove facets…", async ({ page, anvil }) => {
      const crashed = watchReactErrors(page);
      await anvil.rpc<null>("evm_setBlockGasLimit", [`0x${(3_000_000).toString(16)}`]);
      await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
      await connectOnAnvil(page);
      await runPalette(page, "Deploy…");
      const review = new DeployReview(page, "GovernedVault");
      await review.expectOpenOrSkip(crashed);
      await expect(review.root).toContainText(/This deploy needs about [\d.]+M gas; Anvil allows [\d.]+M per transaction\./);
      await expect(review.root.getByRole("button", { name: "Remove facets…", exact: true })).toBeVisible();
    });

    test("rejected in the wallet: \"You canceled in your wallet.\" and Sign again", async ({ page, anvil }) => {
      const crashed = watchReactErrors(page);
      // The wallet answers the send with EIP-1193's 4001, as a person rejecting it would.
      await page.route(
        (url) => !["localhost", "127.0.0.1"].includes(url.hostname),
        async (route) => {
          const body = route.request().postData() ?? "";
          if (!body.includes("eth_sendTransaction")) return route.fallback();
          const id = (JSON.parse(body) as { id?: number }).id ?? 1;
          return route.fulfill({ json: { jsonrpc: "2.0", id, error: { code: 4001, message: "User rejected the request." } } });
        },
      );
      void anvil;
      await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
      await connectOnAnvil(page);
      await runPalette(page, "Deploy…");
      const review = new DeployReview(page, "GovernedVault");
      await review.expectOpenOrSkip(crashed);
      await review.sign().click();
      await expect(review.root).toContainText("You canceled in your wallet.");
      await expect(review.root.getByRole("button", { name: "Sign again", exact: true })).toBeVisible();
    });
  });
});
