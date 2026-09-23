import type { Hex } from "@lattice-studio/core";
import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { doc, getAnalysis, putDeployment, runCommand, session } from "@/contracts";
import { axeViolations } from "@/ui/testing/axe";
import { FAKE_CHAINS, FAKE_CONNECTORS, fakeChainService, healthyChainState } from "../../../test/harness";
import {
  ALICE, BASE_SEPOLIA, SEPOLIA, account, deployableCatalog, fakeDeployController, goOffline, renderReview, section,
  templateProject,
} from "./test-support";

const SAFE = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

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
