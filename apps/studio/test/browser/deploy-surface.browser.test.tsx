/**
 * Board: `design/boards/current-deploy-surface.png` ("Deploy surface", row 07): "Sign & deploy" (Light, stamped)
 * and "Hold to deploy" (Dark, a press-and-hold bar). PA L13 and L74 (bugs/decisions #13, "to design next" #1):
 * dark's hold-to-deploy has no keyboard path and never asks for "override"; the spec drops both hold and
 * override for one confirmation model, and the whole surface is superseded by the real deploy review (Flow 12,
 * `chain/review/DeployReview.tsx`) — nine sections proving readiness, not a static card. The two tests below map
 * directly to the board (the review open, with the chain/path choice visible in Address); everything past that
 * — the review's later phases — is PA L74's "to design next" #1, so it's `provisional-*` here.
 *
 * `chain/review/test-support.tsx`'s `renderReview`, `fakeDeployController`, `deployableCatalog`, `templateProject`
 * and `section` do the rendering; `chain/review/CostSimulationProgress.browser.test.tsx`'s `progressAt` pattern
 * (a `fakeDeployController` opened `at: "progress"`) covers the progress phases, with `fakeClock` so "Pending ·
 * 0:12" doesn't read the real wall clock. The missing-contracts step renders `MissingContractsDialog` directly
 * over a stub machine, as `chain/deploy/deploy.browser.test.tsx` does.
 */
import type { Address, Hex } from "@lattice-studio/core";
import { toChecksum } from "@lattice-studio/core";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import type { DeployState } from "@/contracts";
import { setAppDeployMachine } from "@/chain/deploy/controller";
import type { DeployMachine, MissingStep } from "@/chain/deploy/machine";
import { MissingContractsDialog } from "@/chain/deploy/MissingContractsDialog";
import { fakeChainService, fakeClock, onCleanup, renderWithStudio } from "../harness";
import { account, deployableCatalog, fakeDeployController, renderReview, section, templateProject, SEPOLIA } from "@/chain/review/test-support";

const DIAMOND: Address = toChecksum("0x5fbdb2315678afecb367f032d93f642f64180aa3");
const SAFE: Address = toChecksum("0x71c7656ec7ab88b098defb751b7401b5f6d8976f");
const TX: Hex = `0x${"ab".repeat(32)}`;

/** Two animation frames plus a short delay, so a screenshot lands on a fully composited frame (see
 * provisional-minimap.browser.test.tsx for why). */
async function settleFrame(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, 100));
}

/** Opens the review at its progress, with the fake controller already in `state` (contracts §5.2, `deploy`). */
async function progressAt(state: DeployState, theme: "dark" | "light" = "dark") {
  const opened = await renderReview({
    controller: fakeDeployController({ chainId: SEPOLIA, ...state }),
    at: "progress",
    project: templateProject("ERC20"),
    theme,
  });
  return opened;
}

/** A machine whose missing-contracts step the test drives by hand (`chain/deploy/deploy.browser.test.tsx`). */
function stubMachine(initial: MissingStep) {
  let step = initial;
  const listeners = new Set<(s: MissingStep) => void>();
  const machine = {
    state: (): DeployState => ({ phase: "review" }),
    subscribe: () => () => {},
    missingStep: () => step,
    subscribeMissing(listener: (s: MissingStep) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    prepareMissing: vi.fn(async () => {}),
    deployMissing: vi.fn(async () => {}),
    dispose: () => {},
  };
  onCleanup(setAppDeployMachine(machine as unknown as DeployMachine));
  return { machine, set(next: MissingStep) {
    step = next;
    for (const listener of Array.from(listeners)) listener(step);
  } };
}

const MISSING_ITEMS: MissingStep["items"] = [
  { name: "ERC20", address: "0x4781Ce40aC9dee1b5042eF116E7390880E2a5814", status: "missing", gas: 656_637n },
  { name: "Receive", address: "0x7EC3278C4c8435D3351FEEe3A8CB081807c68F3E", status: "missing", gas: 103_676n },
  { name: "LatticeFactory", address: "0xc192cEa531C8FFb3cBE69A98f4795757E4A2c7be", status: "deployed", gas: 2_734_548n },
];

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

describe.each(["dark", "light"] as const)("board: deploy surface (%s)", (theme) => {
  test("current-deploy-surface: review open, path choice", async () => {
    const chain = fakeChainService({ account: account(), catalog: deployableCatalog() });
    const { dialog, controller } = await renderReview({ project: templateProject("ERC20"), chain, theme });
    controller.set({ phase: "ready", simulation: { ok: true, block: 9123456 } });
    await expect.element(dialog.getByRole("heading", { name: "Deploy ERC20" })).toBeInTheDocument();
    await expect.element(section("Network")).toBeVisible();
    await expect.element(section("Address").getByRole("button", { name: "Use CreateX instead" })).toBeVisible();
    await expect.element(section("Simulation").getByText("Ready")).toBeVisible();
    await document.fonts.ready;
    await settleFrame();
    await expect.element(page.elementLocator(dialog.element() as HTMLElement)).toMatchScreenshot(`current-deploy-surface-review-${theme}`);
  });
});

describe("provisional: the deploy review's later phases (PA L74)", () => {
  test("provisional-deploy-review-missing-contracts: each contract with its address, estimate and state", async () => {
    stubMachine({ chainId: SEPOLIA, preparing: false, running: false, items: MISSING_ITEMS });
    const screen = await renderWithStudio(
      <MissingContractsDialog entry={{ id: "missing-contracts", props: { chainId: SEPOLIA, names: ["ERC20", "Receive"] }, key: 1 }} top />,
    );
    await expect.element(screen.getByRole("dialog", { name: "Deploy missing contracts" })).toBeVisible();
    await expect.element(screen.getByText("2 contracts to deploy · about 760.3K gas")).toBeVisible();
    await document.fonts.ready;
    await settleFrame();
    await expect
      .element(page.elementLocator(screen.getByRole("dialog").element() as HTMLElement))
      .toMatchScreenshot("provisional-deploy-review-missing-contracts");
  });

  test("provisional-deploy-review-pending: counts up and links the transaction", async () => {
    const clock = fakeClock({ at: "2026-01-01T00:00:12.000Z" });
    const { dialog } = await progressAt({ phase: "pending", tx: TX, since: "2026-01-01T00:00:00.000Z", address: DIAMOND });
    await expect.element(dialog.getByRole("status")).toHaveTextContent("Pending · 0:12");
    clock.advance(0);
    await document.fonts.ready;
    await settleFrame();
    await expect.element(page.elementLocator(dialog.element() as HTMLElement)).toMatchScreenshot("provisional-deploy-review-pending");
  });

  test("provisional-deploy-review-proposed: waiting for the Safe to execute the batch", async () => {
    const { dialog } = await progressAt({ phase: "proposed", safe: SAFE, address: DIAMOND });
    await expect.element(dialog.getByRole("status")).toHaveTextContent("Proposed · Sepolia (Safe)");
    await expect.element(dialog.getByRole("button", { name: "Discard proposal" })).toBeVisible();
    await document.fonts.ready;
    await settleFrame();
    await expect.element(page.elementLocator(dialog.element() as HTMLElement)).toMatchScreenshot("provisional-deploy-review-proposed");
  });

  test("provisional-deploy-review-live: the live address, linked, Copy address", async () => {
    const { dialog } = await progressAt({ phase: "live", address: DIAMOND });
    await expect.element(dialog.getByRole("status")).toHaveTextContent("Live · Sepolia");
    await expect.element(dialog.getByRole("link", { name: "Open in explorer" })).toBeVisible();
    await document.fonts.ready;
    await settleFrame();
    await expect.element(page.elementLocator(dialog.element() as HTMLElement)).toMatchScreenshot("provisional-deploy-review-live");
  });
});
