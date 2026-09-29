import type { Address, Hex } from "@lattice-studio/core";
import { formatAddress } from "@lattice-studio/core";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { DEFAULT_SETTINGS, doc, getAnalysis, getCatalog, putDeployment, runCommand, session, settings } from "@/contracts";
import { prediction } from "@/state";
import { keyLabel } from "@/ui/keys/key-labels";
import { overridePlatform } from "@/ui/shared/platform";
import { axeViolations } from "@/ui/testing/axe";
import { FAKE_CHAINS, FAKE_CONNECTORS, fakeChainService, healthyChainState, onCleanup } from "../../../test/harness";
import { appDeployDeps } from "../deploy/app-deps";
import { createDeployMachine, type DeployMachine } from "../deploy/machine";
import { fakePort } from "../deploy/testing";
import { CANCELED_IN_WALLET, CHANGED_SINCE_REVIEW } from "./copy";
import {
  ALICE, BASE_SEPOLIA, SEPOLIA, account, deployableCatalog, fakeDeployController, goOffline, renderReview, section,
  templateProject,
} from "./test-support";

const SAFE = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

/** S1's predicted address now, or null. */
function predictedAddress(): Address | null {
  const p = prediction();
  return p.status === "ready" ? p.address : null;
}

/** "0x5d7B…4C68", as the simulation summary writes an address. */
function short(address: Address | null): string {
  return address === null ? "" : formatAddress(address);
}

function signButton() {
  return page.getByRole("dialog").getByRole("button", { name: /^(Sign & deploy|Sign again)$/ });
}

/** Opens ERC20's review and plays a passed simulation on the snapshot the review opened with. */
async function readyReview(options: Parameters<typeof renderReview>[0] = {}) {
  const opened = await renderReview({ project: templateProject("ERC20"), ...options });
  await expect.poll(() => opened.controller.methods()).toContain("open");
  opened.controller.set({ phase: "ready", simulation: { ok: true, block: 9123456 } });
  return opened;
}

async function tickExamples() {
  await page.getByRole("checkbox", { name: "Keep example values" }).click();
  await expect.element(page.getByRole("checkbox", { name: "Keep example values" })).toBeChecked();
}

describe("the deploy review", () => {
  test("opens with its heading focused, nine sections and the controller opened", async () => {
    const { dialog, controller } = await renderReview({ project: templateProject("ERC20") });
    await expect.element(dialog.getByRole("heading", { name: "Deploy ERC20" })).toHaveFocus();
    for (const title of ["Network", "Deployer", "Address", "What gets cut", "Init", "Authority after deploy", "Checks", "Cost", "Simulation"]) {
      await expect.element(section(title)).toBeVisible();
    }
    await expect.poll(() => controller.methods()).toContain("open");
    await expect.element(section("Network").getByText("Sepolia · LatticeFactory ✓ · 7 of 7 facets and init contracts ✓")).toBeVisible();
    await expect.element(dialog.getByText(/· catalog v0\.4\.0$/)).toBeVisible();
  });

  test.each(["shop", "draft"] as const)("passes axe in the %s theme", async (theme) => {
    await readyReview({ theme });
    await expect.element(section("Checks")).toBeVisible();
    expect(await axeViolations(page.getByRole("dialog").element())).toEqual([]);
  });

  test("Cancel closes it and tells the controller", async () => {
    const { controller } = await renderReview({ project: templateProject("ERC20") });
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(controller.methods()).toContain("close");
  });

  test("at progress it doesn't open a new review", async () => {
    const controller = fakeDeployController({ phase: "pending", chainId: SEPOLIA, since: "2026-09-23T12:00:00.000Z" });
    await renderReview({ project: templateProject("ERC20"), controller, at: "progress" });
    await expect.element(page.getByRole("button", { name: "Close" })).toBeVisible();
    expect(controller.methods()).not.toContain("open");
  });
});

describe("Network (spec L563)", () => {
  test("the chain picker selects the chain and readiness runs again", async () => {
    const { chain } = await renderReview({ project: templateProject("ERC20") });
    await page.getByRole("combobox", { name: "Chain" }).click();
    await page.getByRole("option", { name: "Base Sepolia" }).click();
    await expect.poll(() => session.get().chainId).toBe(BASE_SEPOLIA);
    await expect.poll(() => chain.calls.some((c) => c.method === "probe" && c.args[0] === BASE_SEPOLIA)).toBe(true);
    await expect.element(section("Network").getByText(/^Base Sepolia · LatticeFactory ✓/)).toBeVisible();
  });

  test("a chain that can't be read blocks, with Retry reading and Use another RPC…", async () => {
    const chain = fakeChainService({ account: account(), catalog: deployableCatalog(), down: [SEPOLIA] });
    await renderReview({ project: templateProject("ERC20"), chain });
    const network = section("Network");
    await expect.element(network.getByText("Sepolia's public RPC isn't answering.")).toBeVisible();
    await expect.element(network.getByRole("button", { name: "Retry reading Sepolia" })).toBeVisible();
    await expect.element(network.getByRole("button", { name: "Use another RPC…" })).toBeVisible();
    await expect.element(network.getByText("Blocks deploy")).toBeVisible();
  });

  test("with no chain selected it waits for one", async () => {
    await renderReview({ project: templateProject("ERC20"), session: { chainId: null } });
    await expect.element(section("Network").getByText("Choose a chain first.")).toBeVisible();
    await expect.element(section("Network").getByText("Waiting")).toBeVisible();
    await expect.element(signButton()).toHaveAttribute("aria-disabled", "true");
  });

  test("missing contracts (NET-03) offer Deploy missing contracts…", async () => {
    const shared = { ...healthyChainState(SEPOLIA, "Sepolia", deployableCatalog()).shared, ERC20: { present: false } };
    const chain = fakeChainService({ account: account(), catalog: deployableCatalog(), state: { [SEPOLIA]: { shared } } });
    await renderReview({ project: templateProject("ERC20"), chain });
    const network = section("Network");
    await expect.element(network.getByText(/facets and init contracts aren't on Sepolia yet/)).toBeVisible();
    await expect.element(network.getByRole("button", { name: "Deploy missing contracts…" })).toBeVisible();
    await expect.element(network.getByText("Blocks deploy")).toBeVisible();
    await expect.element(network.getByText(/· 6 of 7 facets and init contracts ✗$/)).toBeVisible();
  });
});

describe("Deployer (spec L564, Flow 14)", () => {
  test("Connect wallet lists browser wallets, then Other wallets (QR)", async () => {
    const chain = fakeChainService({ account: null, catalog: deployableCatalog() });
    await renderReview({ project: templateProject("ERC20"), chain });
    const deployer = section("Deployer");
    await expect.element(deployer.getByText("Connect a wallet first.")).toBeVisible();
    const buttons = deployer.getByRole("button");
    await expect.element(buttons.nth(0)).toHaveAccessibleName("MetaMask");
    await expect.element(buttons.nth(1)).toHaveAccessibleName("Other wallets (QR)");
    await deployer.getByRole("button", { name: "MetaMask" }).click();
    await expect.poll(() => chain.calls.filter((c) => c.method === "connect").map((c) => c.args[0])).toEqual(["io.metamask"]);
    await expect.element(signButton()).toHaveAccessibleDescription("Connect a wallet first.");
  });

  test("the end-to-end build's mock connector (contracts §5.5) is listed with the browser wallets", async () => {
    const connectors = [{ id: "mock", name: "Mock Connector", kind: "mock" as const }, FAKE_CONNECTORS[1]!];
    const chain = fakeChainService({ account: null, catalog: deployableCatalog(), connectors });
    await renderReview({ project: templateProject("ERC20"), chain });
    const deployer = section("Deployer");
    await expect.element(deployer.getByRole("button").nth(0)).toHaveAccessibleName("Mock Connector");
    await expect.element(deployer.getByText(/No wallet found/)).not.toBeInTheDocument();
    await deployer.getByRole("button", { name: "Mock Connector" }).click();
    await expect.poll(() => chain.calls.filter((c) => c.method === "connect").map((c) => c.args[0])).toEqual(["mock"]);
  });

  test("a service that builds a fresh connector list per call doesn't loop the review (React #185, Q1e)", async () => {
    const chain = fakeChainService({ account: null, catalog: deployableCatalog() });
    chain.connectors = () => [...FAKE_CONNECTORS]; // like S8a's service: a new list on every call
    await renderReview({ project: templateProject("ERC20"), chain });
    await expect.element(section("Deployer")).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(section("Deployer").elements()).toHaveLength(1);
  });

  test("no wallet in the browser says so and links to one", async () => {
    const chain = fakeChainService({ account: null, catalog: deployableCatalog(), connectors: [FAKE_CONNECTORS[1]!] });
    await renderReview({ project: templateProject("ERC20"), chain });
    await expect.element(section("Deployer").getByText(/^No wallet found in this browser\./)).toBeVisible();
    await expect.element(section("Deployer").getByRole("link", { name: "Find a wallet" })).toBeVisible();
  });

  test("shows the account in full, its kind and balance; a wallet elsewhere offers Switch network", async () => {
    const chain = fakeChainService({ account: account({ chainId: BASE_SEPOLIA, kind: "delegated" }), catalog: deployableCatalog() });
    await renderReview({ project: templateProject("ERC20"), chain });
    const deployer = section("Deployer");
    await expect.element(deployer.getByText(ALICE)).toBeVisible();
    await expect.element(deployer.getByText("EIP-7702 account")).toBeVisible();
    await expect.element(deployer.getByText("1 ETH")).toBeVisible();
    await expect.element(deployer.getByText("Your wallet is on Base Sepolia.")).toBeVisible();
    await expect.element(deployer.getByText("Blocks deploy")).toBeVisible();
    await deployer.getByRole("button", { name: "Switch network" }).click();
    await expect.poll(() => chain.calls.some((c) => c.method === "switchNetwork" && c.args[0] === SEPOLIA)).toBe(true);
    await expect.element(deployer.getByText("Ready")).toBeVisible();
  });

  test("not enough funds, in Flow 14's words", async () => {
    const chain = fakeChainService({ account: account({ balance: 4n * 10n ** 15n }), catalog: deployableCatalog(), state: { [SEPOLIA]: { gasEstimate: "5000000" } } });
    await readyReview({ chain, fees: async () => ({ ok: true, value: { about: 12n * 10n ** 15n, max: 2n * 10n ** 16n } }) });
    await expect.element(section("Deployer").getByText("Needs about 0.012 ETH; this account has 0.004.")).toBeVisible();
    await tickExamples();
    await expect.element(signButton()).toHaveAccessibleDescription("Needs about 0.012 ETH; this account has 0.004.");
  });

  test.each([
    ["a testnet with a faucet links to it", "https://faucet.example/sepolia"],
    ["a chain without a faucet has no link", null],
  ] as const)("short of funds: %s (spec L592)", async (_name, faucet) => {
    const chains = FAKE_CHAINS.map((c) => (c.id === SEPOLIA && faucet !== null ? { ...c, faucet } : c));
    const chain = fakeChainService({
      account: account({ balance: 4n * 10n ** 15n }), catalog: deployableCatalog(), state: { [SEPOLIA]: { gasEstimate: "5000000" } }, chains,
    });
    await readyReview({ chain, fees: async () => ({ ok: true, value: { about: 12n * 10n ** 15n, max: 2n * 10n ** 16n } }) });
    const deployer = section("Deployer");
    const funds = () => deployer.element().querySelector("[data-funds]")?.textContent ?? "";
    await expect.poll(funds).toMatch(/^Needs about 0\.012 ETH; this account has 0\.004\./);
    const link = deployer.getByRole("link", { name: "Get test ETH from a faucet" });
    if (faucet === null) expect(link.query()).toBeNull();
    else await expect.element(link).toHaveAttribute("href", faucet);
  });

  test("a stop at Sign that dropped the simulation says why, in the footer and the Simulation section, not Simulating…", async () => {
    // Review with no simulation, as stopSign leaves it (the fake's open() doesn't simulate).
    const { controller } = await renderReview({ project: templateProject("ERC20") });
    await expect.poll(() => controller.methods()).toContain("open");
    await tickExamples();
    await expect.element(signButton()).toHaveAccessibleDescription("Simulating…");
    const error = "0x5FbD…0aa3 already has code on Sepolia. Use a new salt.";
    controller.set({ phase: "review", error });
    await expect.element(signButton()).toHaveAccessibleDescription(error);
    await expect.element(page.getByRole("dialog").getByText("Simulating…")).not.toBeInTheDocument();
    const simulation = section("Simulation");
    await expect.element(simulation.getByText(error)).toBeVisible();
    // Nothing runs until the person acts, so it isn't "Waiting" (spec L701): it blocks, with its way out.
    await expect.element(simulation).toHaveAttribute("data-status", "blocked");
    await expect.element(simulation).toHaveAccessibleDescription("Blocks deploy");
    const again = simulation.getByRole("button", { name: "Simulate again" });
    (again.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    expect(controller.calls.filter((c) => c.method === "retry")).toHaveLength(1);
    // The fake's retry() doesn't simulate: play what the machine does, and focus stays in the section.
    controller.set({ phase: "simulating", error: undefined });
    await expect.element(simulation.getByText("Simulating…")).toBeVisible();
    await expect.element(simulation).toHaveAttribute("data-status", "waiting");
    await expect.element(simulation.getByRole("button", { name: "Simulate again" })).not.toBeInTheDocument();
    expect(simulation.element().contains(document.activeElement)).toBe(true);
  });

  test("each stop that drops the simulation blocks with Simulate again, and the footer gives the same reason", async () => {
    const { controller } = await renderReview({ project: templateProject("ERC20") });
    await expect.poll(() => controller.methods()).toContain("open");
    await tickExamples();
    const simulation = section("Simulation");
    // A dropped simulation's reason (the chain module failing to load), then an RPC error.
    for (const error of ["The chain module didn't load. Try again.", "Sepolia's public RPC isn't answering."]) {
      controller.set({ phase: "review", error, simulation: undefined });
      await expect.element(simulation.getByText(error)).toBeVisible();
      await expect.element(simulation).toHaveAttribute("data-status", "blocked");
      await expect.element(simulation.getByRole("button", { name: "Simulate again" })).not.toHaveAttribute("aria-disabled");
      await expect.element(signButton()).toHaveAccessibleDescription(error);
    }
    // A rejection keeps the simulation (FX27): the section stays Ready and has no retry of its own.
    controller.set({ phase: "review", error: CANCELED_IN_WALLET, simulation: { ok: true, block: 9123456 } });
    await expect.element(simulation).toHaveAttribute("data-status", "ok");
    await expect.element(simulation.getByRole("button", { name: "Simulate again" })).not.toBeInTheDocument();
  });

  test("offline, Simulate again is disabled with the reason", async () => {
    goOffline();
    const { controller } = await renderReview({ project: templateProject("ERC20") });
    await expect.poll(() => controller.methods()).toContain("open");
    controller.set({ phase: "review", error: "Deploy needs a connection.", simulation: undefined });
    const again = section("Simulation").getByRole("button", { name: "Simulate again" });
    await expect.element(again).toHaveAttribute("aria-disabled", "true");
    await expect.element(again).toHaveAccessibleDescription("Deploy needs a connection");
    await again.click({ force: true });
    expect(controller.methods()).not.toContain("retry");
  });

  test("a Safe deploys through its batch: Sign & deploy says so and Download Transaction Builder batch is offered", async () => {
    const chain = fakeChainService({ account: account({ address: SAFE, kind: "safe" }), catalog: deployableCatalog() });
    await readyReview({ chain });
    await expect.element(section("Deployer").getByText("Safe", { exact: true })).toBeVisible();
    await expect.element(section("Deployer").getByRole("button", { name: "Download Transaction Builder batch" })).toBeVisible();
    await expect.element(signButton()).toHaveAccessibleDescription("In v1 a Safe deploys through a Transaction Builder batch: download it under Deployer");
  });
});

describe("Address (spec L565)", () => {
  test("shows the path, the salt, the predicted address and that it's free", async () => {
    await renderReview({ project: templateProject("ERC20"), chain: fakeChainService({ account: account(), catalog: deployableCatalog(), state: { [SEPOLIA]: { predictedHasCode: false } } }) });
    const address = section("Address");
    await expect.element(address.getByText(`LatticeFactory at ${deployableCatalog().factory.address}`)).toBeVisible();
    await expect.element(address.getByText(/^0xf39fd6e51aad88f6f4ce6ab8827279cfffb9226600/i)).toBeVisible();
    await expect.element(address.getByText("Free: no code at this address on Sepolia.")).toBeVisible();
    await expect.element(address.getByText("Ready")).toBeVisible();
  });

  test("Use CreateX instead switches the path and shows the scope", async () => {
    await renderReview({ project: templateProject("ERC20") });
    const address = section("Address");
    await address.getByRole("button", { name: "Use CreateX instead" }).click();
    await expect.poll(() => doc.get().deploy.path).toBe("createx");
    await expect.element(address.getByText(/^CreateX CREATE3 at 0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed$/)).toBeVisible();
    await address.getByRole("radio", { name: "This chain only" }).click();
    await expect.poll(() => doc.get().deploy.scope).toBe("this-chain");
    await expect.element(address.getByRole("button", { name: "Use LatticeFactory" })).toBeVisible();
  });

  test("an address already used (NET-05) blocks with Use a new salt", async () => {
    const chain = fakeChainService({ account: account(), catalog: deployableCatalog(), state: { [SEPOLIA]: { predictedHasCode: true } } });
    await renderReview({ project: templateProject("ERC20"), chain });
    const address = section("Address");
    await expect.element(address.getByText(/already deployed a diamond with this salt/)).toBeVisible();
    await expect.element(address.getByText("Blocks deploy")).toBeVisible();
    const before = doc.get().deploy.entropy;
    await address.getByRole("button", { name: "Use a new salt" }).click();
    await expect.poll(() => doc.get().deploy.entropy).not.toBe(before);
  });

  test("Preview for another account… shows where a Safe would deploy", async () => {
    await renderReview({ project: templateProject("ERC20") });
    const address = section("Address");
    await address.getByRole("button", { name: "Preview for another account…" }).click();
    await address.getByRole("textbox", { name: "Another account" }).fill(SAFE);
    await address.getByRole("button", { name: "Preview", exact: true }).click();
    await expect.element(address.getByText(new RegExp(`^Deployed by ${SAFE}, this diamond would be at 0x[0-9a-fA-F]{40}\\.$`))).toBeVisible();
  });
});

describe("Checks, acknowledgements and Sign & deploy (spec L569, L573)", () => {
  test("Sign & deploy waits for the tick, then signs through the controller", async () => {
    const { controller } = await readyReview();
    await expect.element(section("Checks").getByText("Needs a tick")).toBeVisible();
    await expect.element(signButton()).toHaveAccessibleDescription("Tick the acknowledgement first");
    await tickExamples();
    const acked = session.get().acks[getAnalysis().recipeHash] ?? [];
    expect(acked).toEqual(["INIT-05:diamond"]);
    await expect.element(section("Checks").getByText("Ready")).toBeVisible();
    await expect.element(signButton()).not.toHaveAttribute("aria-disabled");
    await signButton().click();
    expect(controller.methods()).toContain("sign");
  });

  test("Keep immutable (CORE-02) and Cut without the registry check (NET-08) are ticks in Checks", async () => {
    const project = templateProject("ERC20");
    // ERC20's template keeps the diamond immutable on purpose; without that flag, CORE-02 asks for the tick.
    const { immutable: _immutable, ...recipe } = project.recipe;
    const erc20 = deployableCatalog().facets.find((f) => f.name === "ERC20");
    const chain = fakeChainService({
      account: account(), catalog: deployableCatalog(),
      state: { [SEPOLIA]: { registry: { records: { [`ERC20@${erc20?.release.version ?? ""}`]: null } } } },
    });
    await readyReview({ project: { ...project, recipe }, chain });
    const checks = section("Checks");
    await expect.element(checks.getByRole("checkbox", { name: "Keep immutable" })).toBeVisible();
    await expect.element(checks.getByRole("checkbox", { name: "Cut without the registry check" })).toBeVisible();
    await expect.element(signButton()).toHaveAccessibleDescription("Tick the 3 acknowledgements first");
    for (const name of ["Keep immutable", "Cut without the registry check", "Keep example values"]) {
      await checks.getByRole("checkbox", { name }).click();
    }
    await expect.element(checks.getByText("Ready")).toBeVisible();
    await expect.element(signButton()).not.toHaveAttribute("aria-disabled");
  });

  test("unticking drops the acknowledgement again", async () => {
    await readyReview();
    await tickExamples();
    await page.getByRole("checkbox", { name: "Keep example values" }).click();
    await expect.poll(() => session.get().acks[getAnalysis().recipeHash] ?? []).toEqual([]);
    await expect.element(signButton()).toHaveAccessibleDescription("Tick the acknowledgement first");
  });

  test("an RPC that can't simulate asks for one extra tick, then signs without a simulation", async () => {
    const { controller } = await readyReview();
    controller.set({
      phase: "review",
      simulation: { ok: false, unavailable: true },
      error: "Sepolia's RPC can't simulate this deploy. Signing without a simulation needs one more tick.",
    });
    await tickExamples();
    const tick = page.getByRole("checkbox", { name: "Deploy without a simulation" });
    await expect.element(tick).toBeVisible();
    await expect.element(signButton()).toHaveAccessibleDescription("Tick the acknowledgement first");
    await tick.click();
    await expect.element(signButton()).not.toHaveAttribute("aria-disabled");
    await signButton().click();
    expect(controller.calls).toContainEqual({ method: "sign", args: [{ withoutSimulation: true }] });
  });

  test("after a cancel in the wallet the Simulation line stays the can't-simulate note", async () => {
    const { controller } = await readyReview();
    controller.set({ phase: "review", simulation: { ok: false, unavailable: true }, error: "You canceled in your wallet." });
    await expect.element(section("Simulation").getByText(/^This RPC couldn't simulate the deploy/)).toBeVisible();
    await expect.element(section("Simulation").getByText("You canceled in your wallet.")).not.toBeInTheDocument();
  });

  test("read-only disables Sign & deploy with the session's reason", async () => {
    await readyReview({ session: { chainId: SEPOLIA, readOnly: "Another tab is editing this project" } });
    await expect.element(signButton()).toHaveAccessibleDescription("Another tab is editing this project");
    await expect.element(signButton()).toHaveAttribute("data-tour", "deploy");
  });

  test("a passed simulation signs plainly", async () => {
    const { controller } = await readyReview();
    await tickExamples();
    await signButton().click();
    expect(controller.calls).toContainEqual({ method: "sign", args: [] });
  });

  test("blockers anywhere keep it disabled with their count", async () => {
    const project = templateProject("ERC20");
    const recipe = { ...project.recipe, facets: project.recipe.facets.filter((f) => f !== "DiamondLoupeFacet") };
    await renderReview({ project: { ...project, recipe } });
    await expect.element(signButton()).toHaveAccessibleDescription("Resolve 1 blocker · F8");
    await expect.element(section("Checks").getByText(/^The loupe is incomplete/)).toBeVisible();
    await expect.element(section("Checks").getByText("Blocks deploy")).toBeVisible();
  });

  test("the blocker count names problem.next's key as remapped, or none when it's unbound (spec L661)", async () => {
    onCleanup(overridePlatform("other"));
    const project = templateProject("ERC20");
    const recipe = { ...project.recipe, facets: project.recipe.facets.filter((f) => f !== "DiamondLoupeFacet") };
    await renderReview({ project: { ...project, recipe }, settings: { keymap: { "problem.next": ["Alt+n"] } } });
    await expect.element(signButton()).toHaveAccessibleDescription(`Resolve 1 blocker · ${keyLabel("Alt+n", "other")}`);
    onCleanup(() => settings.set({ keymap: DEFAULT_SETTINGS.keymap }));
    settings.set({ keymap: { "problem.next": [] } });
    await expect.element(signButton()).toHaveAccessibleDescription("Resolve 1 blocker");
  });

  test("a plain warning (CORE-04) is listed in Checks and doesn't gate Sign & deploy (spec L296)", async () => {
    const project = templateProject("ERC20");
    // Dropping Receive leaves nothing serving plain ETH: a warning with no acknowledgement (contracts §3.1).
    const recipe = { ...project.recipe, facets: project.recipe.facets.filter((f) => f !== "Receive") };
    const { controller } = await readyReview({ project: { ...project, recipe } });
    const checks = section("Checks");
    await expect.element(checks.getByText("Plain ETH sent to this diamond will revert.")).toBeVisible();
    await expect.element(checks.getByRole("img", { name: "Warning" })).toBeVisible();
    // ERC20's own example-values tick still gates it; CORE-04 adds nothing to that count.
    await expect.element(signButton()).toHaveAccessibleDescription("Tick the acknowledgement first");
    await tickExamples();
    await expect.element(checks.getByText("Ready")).toBeVisible();
    await expect.element(checks.getByText("Plain ETH sent to this diamond will revert.")).toBeVisible();
    await expect.element(signButton()).not.toHaveAttribute("aria-disabled");
    await signButton().click();
    expect(controller.methods()).toContain("sign");
  });

  test("offline it says Deploy needs a connection", async () => {
    goOffline();
    await readyReview();
    await expect.element(signButton()).toHaveAccessibleDescription("Deploy needs a connection");
  });

  test("a rejection in the wallet offers Sign again", async () => {
    const { controller } = await readyReview();
    await tickExamples();
    controller.set({ error: "You canceled in your wallet." });
    await expect.element(page.getByRole("button", { name: "Sign again" })).toBeVisible();
  });

  test("after a rejection the review says so, the simulation stands and Sign again enables (spec L574)", async () => {
    const { controller } = await readyReview();
    await tickExamples();
    // S8c goes back to Review (spec L532-L557's diagram) and keeps the simulation: nothing changed.
    controller.set({ phase: "review", error: CANCELED_IN_WALLET });
    // Shown, not announced again: S8c logs it as an Error line, which the console's setting reads (spec L778).
    const note = page.getByRole("dialog").getByText(CANCELED_IN_WALLET);
    await expect.element(note).toBeVisible();
    await expect.element(page.getByRole("status").filter({ hasText: CANCELED_IN_WALLET })).not.toBeInTheDocument();
    await expect.element(section("Simulation").getByText("Simulated at block 9,123,456.")).toBeVisible();
    const again = page.getByRole("button", { name: "Sign again" });
    await expect.element(again).not.toHaveAttribute("aria-disabled", "true");
    await again.click();
    expect(controller.calls).toContainEqual({ method: "sign", args: [] });
  });

  test("back from the wallet after a refusal, focus lands on Sign again, not the page (WCAG 2.4.3)", async () => {
    const { controller } = await readyReview();
    await tickExamples();
    await signButton().click();
    // The wallet asks: the review shows its progress, and Sign & deploy (which had focus) unmounts.
    controller.set({ phase: "awaitingSignature", since: "2026-09-23T12:00:00.000Z" });
    await expect.element(page.getByRole("button", { name: "Close" })).toBeVisible();
    await expect.element(signButton()).not.toBeInTheDocument();
    controller.set({ phase: "review", error: CANCELED_IN_WALLET });
    await expect.element(page.getByRole("button", { name: "Sign again" })).toHaveFocus();
  });

  test("a failed deploy shows its error with Try again", async () => {
    const { controller } = await readyReview();
    controller.set({ phase: "failed", error: "Deploy reverted in LatticeRegistry: `LatticeRegistry__RecordNotFound(lattice.ERC20, 0.4.0)`." });
    await expect.element(page.getByText(/^Deploy reverted in LatticeRegistry/)).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    expect(controller.methods()).toContain("retry");
  });
});

describe("Changed since review (spec L562, L601)", () => {
  test("an edit marks the review changed and simulates again", async () => {
    const { controller } = await readyReview();
    await runCommand({ id: "init.setArg", args: { path: "steps[0].name_", value: "Vault" } }, "api");
    await expect.poll(() => controller.methods()).toContain("changed");
    await expect.element(page.getByText("Changed since review. Simulating again.")).toBeVisible();
    await tickExamples();
    await expect.element(signButton()).toHaveAccessibleDescription("Changed since review. Simulating again.");
  });

  test("an account switch or a chain switch does too", async () => {
    const { controller, chain } = await readyReview();
    await expect.poll(() => controller.methods()).toContain("open");
    chain.setAccount(account({ address: SAFE }));
    await expect.poll(() => controller.methods().filter((m) => m === "changed").length).toBe(1);
    controller.set({ phase: "ready", changedSinceReview: false });
    session.set({ chainId: BASE_SEPOLIA });
    await expect.poll(() => controller.methods().filter((m) => m === "changed").length).toBeGreaterThanOrEqual(2);
  });

  test("the mark stays once the new simulation passes, and Sign enables on the new result", async () => {
    const { controller } = await readyReview();
    await tickExamples();
    controller.set({ phase: "simulating", changedSinceReview: true });
    await expect.element(page.getByRole("status").filter({ hasText: CHANGED_SINCE_REVIEW })).toBeVisible();
    await expect.element(signButton()).toHaveAccessibleDescription(CHANGED_SINCE_REVIEW);
    controller.set({ phase: "ready", simulation: { ok: true, block: 9123457 } });
    await expect.element(page.getByRole("status").filter({ hasText: /^Changed since review\.$/ })).toBeVisible();
    await expect.element(page.getByText(CHANGED_SINCE_REVIEW)).not.toBeInTheDocument();
    await expect.element(section("Simulation").getByText("Simulated at block 9,123,457.")).toBeVisible();
    await expect.element(signButton()).not.toHaveAttribute("aria-disabled", "true");
  });

  test("Use a new salt in the review, with S8c's machine: marked, simulated at the new address, and the mark stays", async () => {
    let machine: DeployMachine | null = null;
    const load = async (): Promise<DeployMachine> => {
      if (machine) return machine;
      const catalog = getCatalog();
      if (!catalog) throw new Error("no catalog");
      const port = fakePort({ catalog: () => catalog, predicted: predictedAddress });
      const built = createDeployMachine({ ...appDeployDeps(), chain: async () => port });
      onCleanup(() => built.dispose());
      machine = built;
      return built;
    };
    await renderReview({ project: templateProject("ERC20"), loadController: load });
    const simulation = section("Simulation");
    const first = predictedAddress();
    expect(first).not.toBeNull();
    await expect.element(simulation.getByText(`Simulated at block 9,123,456: diamond at ${short(first)} with`, { exact: false })).toBeVisible();
    await expect.element(page.getByText(/^Changed since review/)).not.toBeInTheDocument();

    await section("Address").getByRole("button", { name: "Use a new salt" }).click();
    await expect.poll(predictedAddress).not.toBe(first);
    const next = predictedAddress();
    await expect.element(simulation.getByText(`diamond at ${short(next)} with`, { exact: false })).toBeVisible();
    const mark = page.getByRole("status").filter({ hasText: /^Changed since review\.$/ });
    await expect.element(mark).toBeVisible();
    // A fast chain simulates again in milliseconds: the mark is still there well after (spec L562).
    await new Promise((resolve) => setTimeout(resolve, 300));
    await expect.element(mark).toBeVisible();
  });

  test("once signed, edits no longer resend it to simulating", async () => {
    const { controller } = await readyReview();
    controller.set({ phase: "pending", tx: `0x${"12".repeat(32)}` as Hex, chainId: SEPOLIA, since: "2026-09-23T12:00:00.000Z" });
    await runCommand({ id: "init.setArg", args: { path: "steps[0].name_", value: "Vault" } }, "api");
    await expect.element(page.getByRole("button", { name: "Close" })).toBeVisible();
    expect(controller.methods()).not.toContain("changed");
  });
});

describe("Confirm (spec L573)", () => {
  test("the hardware wallet note shows the calldata hash and says blind signing must be on", async () => {
    await readyReview();
    await page.getByText("Using a hardware wallet?").click();
    const note = page.getByRole("group").filter({ hasText: "Using a hardware wallet?" });
    await expect.element(note.getByText(/^0x[0-9a-f]{64}$/)).toBeVisible();
    await expect.element(note.getByText(/^Blind signing must be on/)).toBeVisible();
  });

  test("on a mainnet the project name must be typed, and a mismatch is explained", async () => {
    const chains = [{ ...FAKE_CHAINS[0]!, testnet: false }, FAKE_CHAINS[1]!];
    const chain = fakeChainService({ account: account(), catalog: deployableCatalog(), chains });
    await readyReview({ chain });
    await tickExamples();
    await expect.element(page.getByText(/^This deploys unaudited code/)).toBeVisible();
    await expect.element(signButton()).toHaveAccessibleDescription("Type the project name to confirm");
    const field = page.getByRole("textbox", { name: "Type ERC20 to confirm" });
    await field.fill("erc20");
    await expect.element(page.getByText("That doesn't match. Type the project name exactly as shown: ERC20")).toBeVisible();
    await field.fill("ERC20");
    await expect.element(signButton()).not.toHaveAttribute("aria-disabled");
  });
});

describe("Deploy again (Flow 13)", () => {
  test("the review says the live diamond stays as it is", async () => {
    const live = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    await putDeployment({
      projectId: "test-project", chainId: SEPOLIA, address: live, path: "factory", deployer: ALICE, salt: `0x${"00".repeat(32)}`,
      status: "confirmed", recipeHash: `0x${"11".repeat(32)}`, catalogHash: deployableCatalog().hash, at: "2026-09-23T12:00:00.000Z",
      verification: "exact_match", revision: 1,
    });
    await renderReview({ project: templateProject("ERC20") });
    await expect.element(page.getByText(`This deploys a new diamond at a new address. The live one at ${live} stays as it is. Upgrading it in place arrives in v2.`)).toBeVisible();
  });
});

describe("narrow windows", () => {
  test("fills the screen under 768 px without scrolling sideways", async () => {
    await page.viewport(375, 800);
    await readyReview();
    const dialog = page.getByRole("dialog").element() as HTMLElement;
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    await page.viewport(1440, 900);
  });
});
