import type { Analysis, CommandRef, Deployment, Hex, Problem, ProblemCode, Severity } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command, emptyAnalysis, provideAnalysis, putDeployment } from "@/contracts";
import { account, ALICE, deployableCatalog, goOffline, SEPOLIA } from "@/chain/review/test-support";
import {
  bufferedServices, fakeChainService, fakeClock, onCleanup, overrideCommands, renderWithStudio, seedDeployState,
  type StudioOptions,
} from "../../../test/harness";
import { resetTitleBlockCollapse, TitleBlockContent, type TitleBlockForm } from "./TitleBlock";

const HASH: Hex = `0x${"ab".repeat(32)}`;
const OTHER_HASH: Hex = `0x${"cd".repeat(32)}`;
const DIAMOND = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const block = () => page.getByRole("region", { name: "Title block" });
const deployButton = () => block().getByRole("button", { name: /^Deploy( again)?…/ });

function problem(code: ProblemCode, severity: Severity, id = `${code}:${Math.random()}`): Problem {
  return { id, code, severity, where: [{ kind: "diamond" }], params: {}, message: "", fixes: [] };
}

function useAnalysisOf(patch: Partial<Analysis>): void {
  const analysis = { ...emptyAnalysis(), recipeHash: HASH, ...patch };
  onCleanup(provideAnalysis({ getAnalysis: () => analysis, subscribe: () => () => undefined }));
}

function placed() {
  return makeProject({ name: "Treasury", recipe: makeRecipe({ facets: ["ERC20"] }, deployableCatalog()) });
}

/**
 * Renders the title block alone. `wallet` connects Alice through a fake chain service installed before the
 * session selects its chain, so S1's prediction follows it (as S8b's review tests do).
 */
async function renderBlock(options: StudioOptions & { form?: TitleBlockForm; wallet?: boolean } = {}) {
  resetTitleBlockCollapse();
  const { form, wallet, ...rest } = options;
  if (wallet) fakeChainService({ account: account() }).install();
  return renderWithStudio(
    <div style={{ width: 360 }}>
      <TitleBlockContent {...(form ? { form } : {})} />
    </div>,
    { catalog: deployableCatalog(), project: placed(), ...rest },
  );
}

function record(patch: Partial<Deployment> = {}): Deployment {
  return {
    projectId: "test-project", chainId: SEPOLIA, address: DIAMOND, path: "factory", deployer: ALICE,
    salt: `0x${"00".repeat(32)}`, status: "confirmed", recipeHash: HASH, catalogHash: HASH, at: "2026-09-23T12:00:00.000Z",
    verification: "exact_match", revision: 1, ...patch,
  };
}

/** Expects Deploy to be disabled with exactly `reason` (spec L661). */
async function expectDeployDisabled(reason: string) {
  await expect.element(deployButton()).toHaveAttribute("aria-disabled", "true");
  await expect.element(deployButton()).toHaveAccessibleDescription(reason);
}

describe("the title block, row by row (spec L362)", () => {
  test("shows the name, the chain and path picker, the stamp, the counts and the problems, top to bottom", async () => {
    useAnalysisOf({});
    await renderBlock({ session: { chainId: SEPOLIA } });
    await expect.element(block().getByText("Treasury")).toBeVisible();
    await expect.element(block().getByRole("button", { name: "Chain and path: Sepolia · LatticeFactory" })).toBeVisible();
    await expect.element(block().getByText("Not deployed")).toBeVisible();
    await expect.element(block().getByText("0 facets · 0 selectors")).toBeVisible();
    await expect.element(block().getByText("No problems")).toBeVisible();
    const text = block().element().textContent ?? "";
    const order = ["Treasury", "Sepolia · LatticeFactory", "Not deployed", "0 facets", "No problems", "Deploy…"].map((t) => text.indexOf(t));
    expect(order.every((at, i) => at >= 0 && (i === 0 || at > (order[i - 1] ?? -1)))).toBe(true);
  });

  test("the picker lists the chains and the paths, each on its command", async () => {
    const chosen: CommandRef[] = [];
    overrideCommands([
      command({ id: "chain.select", title: () => "Select chain", category: "Chain", enabled: () => ({ ok: true }), run: (ctx) => void chosen.push(ctx.ref) }),
      command({ id: "deploy.usePath", title: () => "Use path", category: "Deploy", enabled: () => ({ ok: true }), run: (ctx) => void chosen.push(ctx.ref) }),
    ]);
    await renderBlock();
    await block().getByRole("button", { name: "Chain and path: Choose a chain · LatticeFactory" }).click();
    const menu = page.getByRole("menu", { name: "Chain and path" });
    await expect.element(menu.getByRole("menuitemradio", { name: "HSKChain Testnet" })).toBeVisible();
    await expect.element(menu.getByRole("menuitemradio", { name: "Hedera Testnet" })).toBeVisible();
    await menu.getByRole("menuitemradio", { name: "Base Sepolia" }).click();
    // A radio choice keeps the menu open, so the path can be chosen next: End reaches CreateX, Enter picks it.
    await expect.element(menu).toBeVisible();
    await userEvent.keyboard("{End}");
    await expect.element(menu.getByRole("menuitemradio", { name: "CreateX" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => chosen.length).toBe(2);
    expect(chosen).toEqual([
      { id: "chain.select", args: { chainId: 84532 } },
      { id: "deploy.usePath", args: { path: "createx" } },
    ]);
  });
});

describe("the title block in each state of the states table (spec L374-L389)", () => {
  test("Empty: address —, Deploy disabled: Place facets first, and no counts until a facet is placed", async () => {
    useAnalysisOf({ problems: [problem("CORE-01", "blocker"), problem("DEP-02", "warning")] });
    await renderBlock({ project: makeProject({ recipe: makeRecipe({}, deployableCatalog()) }) });
    await expect.element(block().getByText("—", { exact: true })).toBeVisible();
    await expectDeployDisabled("Place facets first");
    expect(block().element().querySelector("[data-problems]")).toBeNull();
    expect(block().element().querySelector("[data-counts]")).toBeNull();
    expect(block().element().textContent).not.toMatch(/blocker|warning|selectors/);
  });

  test("the counts show once a facet is placed", async () => {
    useAnalysisOf({ problems: [problem("CORE-01", "blocker"), problem("DEP-02", "warning")] });
    await renderBlock();
    await expect.element(block().getByText("1 blocker · 1 warning")).toBeVisible();
    await expect.element(block().getByText("0 facets · 0 selectors")).toBeVisible();
  });

  test("Composing, no problems: No problems; Deploy enabled", async () => {
    useAnalysisOf({});
    await renderBlock({ session: { chainId: SEPOLIA } });
    await expect.element(block().getByText("No problems")).toBeVisible();
    await expect.element(deployButton()).not.toHaveAttribute("aria-disabled");
    await expect.element(deployButton()).toHaveAccessibleName("Deploy…");
  });

  test("Composing: without a wallet the address says why there's none (spec L362)", async () => {
    useAnalysisOf({});
    await renderBlock({ session: { chainId: SEPOLIA } });
    await expect
      .element(block().getByText("Connect a wallet to see the deploy address (it depends on the deploying account)"))
      .toBeVisible();
  });

  test("Composing: the predicted address, with Copy through copyText", async () => {
    useAnalysisOf({});
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    onCleanup(() => writeText.mockRestore());
    await renderBlock({ session: { chainId: SEPOLIA }, wallet: true });
    const address = block().getByTitle(/^0x[0-9a-fA-F]{40}$/);
    await expect.element(address).toBeVisible();
    const full = (address.element() as HTMLElement).title;
    await expect.element(block().getByText("Predicted")).toBeVisible();
    await block().getByRole("button", { name: "Copy address" }).click();
    await expect.poll(() => bufferedServices().toast.at(-1)?.text).toBe(`Copied ${full.slice(0, 6)}…${full.slice(-4)}`);
    expect(writeText).toHaveBeenCalledWith(full);
  });

  test("Blockers present: 2 blockers; Deploy disabled: Resolve 2 blockers · F8", async () => {
    useAnalysisOf({ problems: [problem("SEL-01", "blocker"), problem("CORE-01", "blocker"), problem("DEP-02", "warning")] });
    await renderBlock();
    await expect.element(block().getByText("2 blockers · 1 warning")).toBeVisible();
    await expectDeployDisabled("Resolve 2 blockers · F8");
  });

  test("Missing arguments: 1 parameter to fill, with Fill in on init.open (Flow 2 step 5)", async () => {
    const opened: CommandRef[] = [];
    overrideCommands([
      command({ id: "init.open", title: () => "Open init plan", category: "Build", enabled: () => ({ ok: true }), run: (ctx) => void opened.push(ctx.ref) }),
    ]);
    useAnalysisOf({ problems: [problem("INIT-01", "blocker")] });
    await renderBlock();
    await expect.element(block().getByText("1 parameter to fill")).toBeVisible();
    await block().getByRole("button", { name: "Fill in" }).click();
    expect(opened).toEqual([{ id: "init.open" }]);
  });

  test("No missing arguments: no Fill in", async () => {
    useAnalysisOf({});
    await renderBlock();
    await expect.element(block().getByText("No problems")).toBeVisible();
    await expect.element(block().getByRole("button", { name: "Fill in" })).not.toBeInTheDocument();
  });

  test("Deploying: Confirm in {wallet}, then Pending · 0:12; Deploy disabled while it's on its way", async () => {
    useAnalysisOf({});
    fakeClock({ at: "2026-09-23T12:00:12.000Z" });
    await renderBlock({ session: { chainId: SEPOLIA }, wallet: true });
    seedDeployState({ phase: "awaitingSignature", chainId: SEPOLIA });
    await expect.element(block().getByText("Confirm in MetaMask")).toBeVisible();
    await expectDeployDisabled("This deploy is already on its way");
    seedDeployState({ phase: "pending", chainId: SEPOLIA, since: "2026-09-23T12:00:00.000Z", address: DIAMOND });
    await expect.element(block().getByText("Pending · 0:12")).toBeVisible();
    await expect.element(block().getByText("Predicted")).toBeVisible();
    await expectDeployDisabled("This deploy is already on its way");
    // Landed: the address is the diamond's own from here.
    seedDeployState({ phase: "verifying", chainId: SEPOLIA, address: DIAMOND });
    await expect.element(block().getByText("Deployed")).toBeVisible();
    await expect.element(block().getByTitle(DIAMOND)).toBeVisible();
  });

  test("Deploying after a live deploy: Deploy again… can't start a second deploy while one is pending", async () => {
    useAnalysisOf({ recipeHash: OTHER_HASH });
    await putDeployment(record());
    await renderBlock({ session: { chainId: SEPOLIA }, chain: true });
    await expect.element(deployButton()).toHaveAccessibleName("Deploy again…");
    seedDeployState({ phase: "pending", chainId: SEPOLIA, since: "2026-09-23T12:00:00.000Z" });
    await expectDeployDisabled("This deploy is already on its way");
  });

  test("Proposed: Proposed · Sepolia (Safe); Deploy disabled: Waiting for the Safe to execute the batch", async () => {
    useAnalysisOf({});
    await renderBlock({ session: { chainId: SEPOLIA }, chain: true });
    seedDeployState({ phase: "proposed", chainId: SEPOLIA, safe: ALICE, address: DIAMOND });
    await expect.element(block().getByText("Proposed · Sepolia (Safe)")).toBeVisible();
    await expectDeployDisabled("Waiting for the Safe to execute the batch");
  });

  test("Live: Live · Sepolia · r1 with the address linked to the explorer", async () => {
    useAnalysisOf({});
    await putDeployment(record());
    await renderBlock({ session: { chainId: SEPOLIA }, chain: true });
    await expect.element(block().getByText("Live · Sepolia · r1")).toBeVisible();
    const link = block().getByRole("link", { name: `${DIAMOND} (opens in a new tab)` });
    await expect.element(link).toHaveAttribute("href", `https://sepolia.etherscan.io/address/${DIAMOND}`);
    await expect.element(block().getByText("Deployed")).toBeVisible();
    await expect.element(deployButton()).toHaveAccessibleName("Deploy…");
  });

  test("Live, then modified: Modified since r1 and Deploy again…", async () => {
    useAnalysisOf({ recipeHash: OTHER_HASH });
    await putDeployment(record());
    const again: CommandRef[] = [];
    overrideCommands([
      command({ id: "deploy.again", title: () => "Deploy again…", category: "Deploy", enabled: () => ({ ok: true }), run: (ctx) => void again.push(ctx.ref) }),
    ]);
    await renderBlock({ session: { chainId: SEPOLIA }, chain: true });
    await expect.element(block().getByText("Modified since r1")).toBeVisible();
    await deployButton().click();
    expect(again).toEqual([{ id: "deploy.again" }]);
  });

  test("Mismatch: Mismatch · Sepolia with Compare with the sheet…", async () => {
    useAnalysisOf({});
    const compared: CommandRef[] = [];
    overrideCommands([
      command({ id: "deploy.compare", title: () => "Compare with the sheet…", category: "Deploy", enabled: () => ({ ok: true }), run: (ctx) => void compared.push(ctx.ref) }),
    ]);
    await putDeployment(record({ status: "mismatch" }));
    await renderBlock({ session: { chainId: SEPOLIA }, chain: true });
    await expect.element(block().getByText("Mismatch · Sepolia")).toBeVisible();
    await block().getByRole("button", { name: "Compare with the sheet…" }).click();
    expect(compared).toEqual([{ id: "deploy.compare", args: { chainId: SEPOLIA, address: DIAMOND } }]);
  });

  test("Offline: the last prediction, marked offline; Deploy disabled: Deploy needs a connection", async () => {
    useAnalysisOf({});
    goOffline();
    await renderBlock({ session: { chainId: SEPOLIA }, wallet: true });
    await expect.element(block().getByTitle(/^0x[0-9a-fA-F]{40}$/)).toBeVisible();
    await expect.element(block().getByText("offline", { exact: true })).toBeVisible();
    await expectDeployDisabled("Deploy needs a connection");
  });

  test("Read-only: Deploy disabled with the same reason", async () => {
    useAnalysisOf({});
    await renderBlock({ session: { readOnly: "Another tab is editing this project" } });
    await expectDeployDisabled("Another tab is editing this project");
  });

  test("Read-only on an empty sheet: the read-only reason outranks Place facets first", async () => {
    useAnalysisOf({});
    await renderBlock({
      project: makeProject({ recipe: makeRecipe({}, deployableCatalog()) }),
      session: { readOnly: "Another tab is editing this project" },
    });
    await expectDeployDisabled("Another tab is editing this project");
  });
});

describe("the title block's forms (spec L362, L368)", () => {
  test("collapses to one row (stamp, short address, Deploy…) and expands again, remembered while open", async () => {
    useAnalysisOf({});
    await renderBlock({ session: { chainId: SEPOLIA }, wallet: true });
    await expect.element(block().getByTitle(/^0x[0-9a-fA-F]{40}$/)).toBeVisible();
    const collapse = block().getByRole("button", { name: "Collapse title block" });
    await expect.element(collapse).toHaveAttribute("aria-expanded", "true");
    await expect.element(collapse).toHaveAttribute("aria-controls", block().element().id);
    await collapse.click();
    await expect.element(block()).toHaveAttribute("data-form", "collapsed");
    await expect.element(block().getByText("Not deployed")).toBeVisible();
    await expect.element(block().getByText(/^0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/)).toBeVisible();
    await expect.element(deployButton()).toBeVisible();
    await expect.element(block().getByText("Treasury")).not.toBeInTheDocument();
    const expand = block().getByRole("button", { name: "Expand title block" });
    await expect.element(expand).toHaveAttribute("aria-expanded", "false");
    await expand.click();
    await expect.element(block()).toHaveAttribute("data-form", "full");
    await expect.element(block().getByRole("button", { name: "Collapse title block" })).toHaveFocus();
  });

  test("the strip (768-1023 px) keeps the stamp and the short address, and no Deploy", async () => {
    useAnalysisOf({});
    await renderBlock({ form: "strip", session: { chainId: SEPOLIA }, wallet: true });
    await expect.element(block().getByText("Not deployed")).toBeVisible();
    await expect.element(block().getByText(/^0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/)).toBeVisible();
    await expect.element(deployButton()).not.toBeInTheDocument();
  });
});

describe("commands the title block leans on", () => {
  test("Deploy… runs deploy.open", async () => {
    useAnalysisOf({});
    const opened: CommandRef[] = [];
    overrideCommands([
      command({ id: "deploy.open", title: () => "Deploy…", category: "Deploy", enabled: () => ({ ok: true }), run: (ctx) => void opened.push(ctx.ref) }),
    ]);
    await renderBlock();
    await deployButton().click();
    expect(opened).toEqual([{ id: "deploy.open" }]);
  });
});
