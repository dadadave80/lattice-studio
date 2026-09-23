import type { Address, Hex } from "@lattice-studio/core";
import { toChecksum } from "@lattice-studio/core";
import { describe, expect, test, vi } from "vitest";
import { getAnalysis, type DeployState } from "@/contracts";
import { bufferedServices, fakeChainService, fakeClock, onCleanup } from "../../../test/harness";
import { NO_SIMULATION_NOTE, NO_SIMULATION_TICK } from "./copy";
import { matchesText } from "./progress-view";
import {
  BASE_SEPOLIA, SEPOLIA, account, deployableCatalog, fakeDeployController, renderReview, section, templateProject,
} from "./test-support";

const TX: Hex = `0x${"ab".repeat(32)}`;
const DIAMOND: Address = toChecksum("0x5fbdb2315678afecb367f032d93f642f64180aa3");
const SAFE: Address = toChecksum("0x71c7656ec7ab88b098defb751b7401b5f6d8976f");
const REVERT = "Deploy reverted in LatticeRegistry: LatticeRegistry__RecordNotFound(lattice.ERC20, 0.4.0)";

function chainWith(gasEstimate: string, chainId = SEPOLIA) {
  return fakeChainService({
    account: account({ chainId }),
    catalog: deployableCatalog(),
    state: { [chainId]: { gasEstimate, gasCap: "16777216" } },
  });
}

function stubClipboard() {
  const spy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  onCleanup(() => spy.mockRestore());
  return spy;
}

/** Opens the review with the fake controller in Review, as `open()` leaves it. */
async function openReview() {
  const opened = await renderReview({ project: templateProject("ERC20") });
  await expect.poll(() => opened.controller.methods()).toContain("open");
  return opened;
}

describe("Cost", () => {
  test("shows the gas, the fees, the calldata size and the share of the cap", async () => {
    await renderReview({ project: templateProject("ERC20"), chain: chainWith("5200000") });
    const cost = section("Cost");
    await expect.element(cost.getByText("about 5.2M gas")).toBeVisible();
    await expect.element(cost.getByText("about 0.001 ETH · at most 0.002 ETH")).toBeVisible();
    await expect.element(cost.getByText(/^[\d,]+ bytes$/)).toBeVisible();
    await expect.element(cost.getByText("31% of Sepolia's 16.8M per-transaction cap")).toBeVisible();
    await expect.element(cost).toHaveAttribute("data-status", "ok");
    // Not an OP Stack chain: no L1 data fee.
    await expect.element(cost.getByText("L1 data fee")).not.toBeInTheDocument();
  });

  test("waits for the gas before it can say the share", async () => {
    await renderReview({ project: templateProject("ERC20") });
    const cost = section("Cost");
    await expect.element(cost.getByText("Estimated once the simulation runs")).toBeVisible();
    await expect.element(cost.getByText("Known once the gas is estimated")).toBeVisible();
    await expect.element(cost).toHaveAttribute("data-status", "waiting");
  });

  test("an estimate over the cap blocks with NET-06 and Remove facets…", async () => {
    await renderReview({ project: templateProject("ERC20"), chain: chainWith("17200000") });
    const cost = section("Cost");
    await expect.element(cost.getByText("This deploy needs about 17.2M gas; Sepolia allows 16.8M per transaction.")).toBeVisible();
    await expect.element(cost.getByRole("button", { name: "Remove facets…" })).toBeVisible();
    await expect.element(cost).toHaveAttribute("data-status", "blocked");
    await expect.element(cost.getByText("Blocks deploy")).toBeVisible();
  });

  test("shows the L1 data fee on an OP Stack chain", async () => {
    await renderReview({
      project: templateProject("ERC20"),
      session: { chainId: BASE_SEPOLIA },
      chain: chainWith("5200000", BASE_SEPOLIA),
      fees: async () => ({ ok: true, value: { about: 10n ** 15n, max: 2n * 10n ** 15n, l1: 3n * 10n ** 13n } }),
    });
    const cost = section("Cost");
    await expect.element(cost.getByText("L1 data fee")).toBeVisible();
    await expect.element(cost.getByText("0.00003 ETH")).toBeVisible();
    await expect.element(cost.getByText("31% of Base Sepolia's 16.8M per-transaction cap")).toBeVisible();
  });

  test("a fee read that fails says why", async () => {
    await renderReview({
      project: templateProject("ERC20"),
      chain: chainWith("5200000"),
      fees: async () => ({ ok: false, error: "Sepolia's public RPC isn't answering." }),
    });
    await expect.element(section("Cost").getByText("Sepolia's public RPC isn't answering.")).toBeVisible();
  });
});

describe("Simulation", () => {
  test("a passed simulation says what it found, and the section is ready", async () => {
    const { controller } = await openReview();
    const summary = "Simulated at block 9,123,456: diamond at 0x… with 4 facets, 20 selectors, 3 events.";
    controller.set({ phase: "ready", snapshot: getAnalysis().recipeHash, simulation: { ok: true, block: 9123456, summary } });
    const simulation = section("Simulation");
    await expect.element(simulation.getByText(summary)).toBeVisible();
    await expect.element(simulation.getByText("Ready")).toBeVisible();
  });

  test("without a summary it names the block", async () => {
    const { controller } = await openReview();
    controller.set({ phase: "ready", simulation: { ok: true, block: 9123456 } });
    await expect.element(section("Simulation").getByText("Simulated at block 9,123,456.")).toBeVisible();
  });

  test("simulating, and simulating again after a change", async () => {
    const { controller } = await openReview();
    controller.set({ phase: "simulating" });
    const simulation = section("Simulation");
    await expect.element(simulation.getByText("Simulating…")).toBeVisible();
    await expect.element(simulation).toHaveAttribute("data-status", "waiting");
    controller.set({ phase: "ready", changedSinceReview: true, simulation: { ok: true, block: 1 } });
    await expect.element(simulation.getByText("Simulating…")).toBeVisible();
  });

  test("a revert blocks, shows the decoded error, and Copy details copies a report", async () => {
    const writeText = stubClipboard();
    const { controller } = await openReview();
    controller.set({ phase: "review", simulation: { ok: false, revert: REVERT } });
    const simulation = section("Simulation");
    await expect.element(simulation.getByText(REVERT)).toBeVisible();
    await expect.element(simulation.getByText("Blocks deploy")).toBeVisible();
    await simulation.getByRole("button", { name: "Copy details" }).click();
    await expect.poll(() => writeText.mock.calls.length).toBe(1);
    const report = String(writeText.mock.calls[0]?.[0]);
    expect(report).toContain(REVERT);
    expect(report).toContain(`Recipe: ${getAnalysis().recipeHash}`);
    expect(report).toContain(`Chain: Sepolia (${SEPOLIA})`);
    expect(report).toContain("Path: LatticeFactory");
    expect(bufferedServices().toast.at(-1)).toEqual({ text: "Copied details" });
  });

  test("an RPC that can't simulate needs the tick, and the tick makes it ready", async () => {
    const { controller, dialog } = await openReview();
    controller.set({ phase: "review", simulation: { ok: false } });
    const simulation = section("Simulation");
    await expect.element(simulation.getByText(NO_SIMULATION_NOTE)).toBeVisible();
    await expect.element(simulation.getByText("Needs a tick")).toBeVisible();
    await dialog.getByRole("checkbox", { name: NO_SIMULATION_TICK }).click();
    await expect.element(simulation).toHaveAttribute("data-status", "ok");
  });

  test("says so while the deploy controller isn't built", async () => {
    const { controller } = await openReview();
    controller.set({ phase: "idle" });
    const simulation = section("Simulation");
    await expect.element(simulation.getByText("Not built yet · WP-S8c")).toBeVisible();
    await expect.element(simulation.getByText("Waiting")).toBeVisible();
  });
});

describe("Progress", () => {
  async function progressAt(state: DeployState) {
    const opened = await renderReview({
      controller: fakeDeployController({ chainId: SEPOLIA, ...state }),
      at: "progress",
      project: templateProject("ERC20"),
    });
    return { ...opened, status: opened.dialog.getByRole("status") };
  }

  test("asks to confirm in the wallet, with Close in the footer", async () => {
    const { dialog, status } = await progressAt({ phase: "awaitingSignature" });
    await expect.element(status).toHaveTextContent("Confirm in MetaMask");
    await expect.element(dialog.getByRole("button", { name: "Close" })).toBeVisible();
    await expect.element(dialog.getByRole("button", { name: "Sign & deploy" })).not.toBeInTheDocument();
    await expect.element(section("Cost")).not.toBeInTheDocument();
  });

  test("pending counts up and links the transaction", async () => {
    const clock = fakeClock({ at: "2026-01-01T00:00:12.000Z" });
    const { dialog, status } = await progressAt({ phase: "pending", tx: TX, since: "2026-01-01T00:00:00.000Z", address: DIAMOND });
    await expect.element(status).toHaveTextContent("Pending · 0:12");
    const link = dialog.getByRole("link", { name: TX });
    await expect.element(link).toHaveAttribute("href", `https://sepolia.etherscan.io/tx/${TX}`);
    await expect.element(link).toHaveAttribute("target", "_blank");
    await expect.element(link).toHaveAttribute("rel", "noreferrer");
    clock.advance(1000);
    await expect.element(status, { timeout: 2500 }).toHaveTextContent("Pending · 0:13");
  });

  test("stale offers Keep waiting, Check wallet and Review again", async () => {
    const { dialog, status } = await progressAt({ phase: "stale", tx: TX });
    await expect.element(status).toHaveTextContent("Not seen for 3 minutes. It may have been dropped.");
    for (const name of ["Keep waiting", "Check wallet", "Review again"]) {
      await expect.element(dialog.getByRole("button", { name })).toBeVisible();
    }
  });

  test("stale follows the receipt timeout setting", async () => {
    const opened = await renderReview({
      controller: fakeDeployController({ phase: "stale", tx: TX, chainId: SEPOLIA }),
      at: "progress",
      project: templateProject("ERC20"),
      settings: { receiptTimeout: 60 },
    });
    await expect.element(opened.dialog.getByRole("status")).toHaveTextContent("Not seen for 1 minute. It may have been dropped.");
  });

  test("proposed to a Safe", async () => {
    const { dialog, status } = await progressAt({ phase: "proposed", safe: SAFE, address: DIAMOND });
    await expect.element(status).toHaveTextContent("Proposed · Sepolia (Safe)");
    await expect.element(dialog.getByText(`Proposed to Safe ${SAFE} on Sepolia. Waiting for the Safe to execute the batch.`)).toBeVisible();
    await expect.element(dialog.getByText(DIAMOND)).toBeVisible();
    await expect.element(dialog.getByRole("button", { name: "Discard proposal" })).toBeVisible();
  });

  test("confirmed reads facets()", async () => {
    const { status } = await progressAt({ phase: "confirmed", tx: TX, address: DIAMOND });
    await expect.element(status).toHaveTextContent(`Deployed at ${DIAMOND}. Reading facets() to compare with the plan…`);
  });

  test("verifying says the diamond matches the sheet", async () => {
    const { dialog, status } = await progressAt({ phase: "verifying", address: DIAMOND });
    const { plan } = getAnalysis();
    const selectors = plan.reduce((sum, entry) => sum + entry.selectors.length, 0);
    await expect.element(status).toHaveTextContent(matchesText(plan.length, selectors));
    await expect.element(dialog.getByText("Verifying on Sourcify…")).toBeVisible();
  });

  test("live links the explorer and copies the address", async () => {
    const writeText = stubClipboard();
    const { dialog, status } = await progressAt({ phase: "live", address: DIAMOND });
    await expect.element(status).toHaveTextContent("Live · Sepolia");
    await expect.element(dialog.getByText(DIAMOND)).toBeVisible();
    await expect.element(dialog.getByRole("link", { name: "Open in explorer" })).toHaveAttribute(
      "href",
      `https://sepolia.etherscan.io/address/${DIAMOND}`,
    );
    await dialog.getByRole("button", { name: "Copy address" }).click();
    await expect.poll(() => writeText.mock.calls[0]?.[0]).toBe(DIAMOND);
  });

  test("a mismatch offers Compare with the sheet… and Use a new salt", async () => {
    const { dialog, status } = await progressAt({ phase: "mismatch", address: DIAMOND });
    await expect.element(status).toHaveTextContent("Deployed, but doesn't match the sheet");
    await expect.element(dialog.getByRole("button", { name: "Compare with the sheet…" })).toBeVisible();
    await expect.element(dialog.getByRole("button", { name: "Use a new salt" })).toBeVisible();
  });
});
