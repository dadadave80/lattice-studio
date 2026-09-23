/**
 * The deploy engine's UI bindings, with mocks: the missing-contracts dialog over a stub machine, S8c's commands and
 * their reasons per phase, the controller's registration behind `deployController()` and its mirror, the app wiring
 * of records and console lines, and the light watcher that loads the controller when a record needs it.
 */
import type { Address, Deployment } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { describe, expect, test, vi } from "vitest";
import {
  commandState, deployController, deployState, getAnalysis, listDeployments, provideAnalysis, provideDeployController, putDeployment,
  registerDialog, runCommand,
  session, useDeployState, type DeployController, type DeployPhase, type DeployState,
} from "@/contracts";
import { bufferedServices, fixtureCatalog, onCleanup, renderWithStudio, seedDeployState, seedStudio } from "../../../test/harness";
import { axeViolations } from "@/ui/testing/axe";
import { appDeployDeps } from "./app-deps";
import { setAppDeployMachine } from "./controller";
import { createDeployMachine, type DeployMachine, type MissingStep } from "./machine";
import { MissingContractsDialog } from "./MissingContractsDialog";
import { startDivergenceWatch } from "./diverged";
import { needsController, startDeployTracking } from "./tracking";
import { deployHarness, flush } from "./testing";

const SEPOLIA = 11155111;
const SAFE = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" as Address;

/** A machine whose missing-contracts step the test drives by hand. */
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
  return {
    machine,
    set(next: MissingStep) {
      step = next;
      for (const listener of Array.from(listeners)) listener(step);
    },
  };
}

const ITEMS: MissingStep["items"] = [
  { name: "ERC20", address: "0x4781Ce40aC9dee1b5042eF116E7390880E2a5814", status: "missing", gas: 656_637n },
  { name: "Receive", address: "0x7EC3278C4c8435D3351FEEe3A8CB081807c68F3E", status: "missing", gas: 103_676n },
  { name: "LatticeFactory", address: "0xc192cEa531C8FFb3cBE69A98f4795757E4A2c7be", status: "deployed", gas: 2_734_548n },
];

function entry(names = ["ERC20", "Receive"]) {
  return { id: "missing-contracts" as const, props: { chainId: SEPOLIA, names }, key: 1 };
}

describe("Deploy missing contracts", () => {
  test("lists each contract with its address, estimate and state, and prepares the step for the chain", async () => {
    const stub = stubMachine({ chainId: SEPOLIA, preparing: false, running: false, items: ITEMS });
    const screen = await renderWithStudio(<MissingContractsDialog entry={entry()} top />);
    await expect.element(screen.getByRole("dialog", { name: "Deploy missing contracts" })).toBeVisible();
    expect(stub.machine.prepareMissing).toHaveBeenCalledWith(SEPOLIA, ["ERC20", "Receive"]);
    const list = screen.getByRole("list", { name: "Missing contracts" });
    await expect.element(list).toBeVisible();
    const rows = list.element().textContent ?? "";
    expect(rows).toContain("ERC20");
    expect(rows).toContain("0x4781…5814");
    expect(rows).toContain("about 656.6K gas");
    expect(rows).toContain("Deployed");
    await expect.element(screen.getByText("2 contracts to deploy · about 760.3K gas")).toBeVisible();
    await expect.element(screen.getByText(
      "Each deploys through Arachnid's proxy at its release address, which depends only on its bytecode, so any connected account can do this.",
    )).toBeVisible();
  });

  test("Deploy sends what's missing; while it runs the button explains itself, and rows read Pending", async () => {
    const stub = stubMachine({ chainId: SEPOLIA, preparing: false, running: false, items: ITEMS });
    const screen = await renderWithStudio(<MissingContractsDialog entry={entry()} top />);
    await screen.getByRole("button", { name: "Deploy 2 contracts" }).click();
    expect(stub.machine.deployMissing).toHaveBeenCalledWith(["ERC20", "Receive"]);
    stub.set({ chainId: SEPOLIA, preparing: false, running: true, items: ITEMS.map((i) => (i.status === "missing" ? { ...i, status: "pending" } : i)) });
    const primary = screen.getByRole("button", { name: /^Deploy/ });
    await expect.element(primary).toHaveAttribute("aria-disabled", "true");
    await expect.element(screen.getByText("Deploying 2 contracts…")).toBeVisible();
    await vi.waitFor(() => expect(screen.getByRole("list").element().textContent).toContain("Pending"));
    await primary.click({ force: true });
    expect(stub.machine.deployMissing).toHaveBeenCalledTimes(1);
  });

  test("a failed contract shows why and Retry deploys just it; the step's error is an alert", async () => {
    const stub = stubMachine({
      chainId: SEPOLIA, preparing: false, running: false, error: "You canceled in your wallet.",
      items: [
        { ...ITEMS[0]!, status: "deployed" },
        { ...ITEMS[1]!, status: "failed", reason: "Creating Receive reverts: Arachnid's proxy gives no reason, so check the gas and the chain's code size limit." },
      ],
    });
    const screen = await renderWithStudio(<MissingContractsDialog entry={entry()} top />, { theme: "draft" });
    await expect.element(screen.getByRole("alert")).toHaveTextContent("You canceled in your wallet.");
    await expect.element(screen.getByText(/^Creating Receive reverts/)).toBeVisible();
    await screen.getByRole("button", { name: "Retry Receive" }).click();
    expect(stub.machine.deployMissing).toHaveBeenCalledWith(["Receive"]);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  test("in a read-only tab, Deploy is aria-disabled with the reason", async () => {
    stubMachine({ chainId: SEPOLIA, preparing: false, running: false, items: ITEMS });
    const screen = await renderWithStudio(<MissingContractsDialog entry={entry()} top />, { session: { readOnly: "Another tab is editing this project." } });
    const primary = screen.getByRole("button", { name: /^Deploy/ });
    await expect.element(primary).toHaveAttribute("aria-disabled", "true");
    await expect.element(primary).toHaveAccessibleDescription(/Another tab is editing this project\./);
  });

  test("while it reads the chain, Deploy says so; with nothing missing, it says every contract is there", async () => {
    const stub = stubMachine({ chainId: SEPOLIA, preparing: true, running: false, items: ITEMS });
    const screen = await renderWithStudio(<MissingContractsDialog entry={entry()} top />);
    await expect.element(screen.getByText("Reading the chain…", { exact: true }).first()).toBeVisible();
    stub.set({ chainId: SEPOLIA, preparing: false, running: false, items: ITEMS.map((i) => ({ ...i, status: "deployed" as const })) });
    const primary = screen.getByRole("button", { name: /^Deploy/ });
    await expect.element(primary).toHaveAttribute("aria-disabled", "true");
    await expect.element(primary).toHaveAccessibleDescription(/Every contract is on this chain\./);
  });
});

describe("commands", () => {
  const cases: [DeployPhase, string, boolean][] = [
    ["stale", "deploy.keepWaiting", true],
    ["pending", "deploy.keepWaiting", false],
    ["stale", "deploy.checkWallet", true],
    ["stale", "deploy.reviewAgain", true],
    ["review", "deploy.reviewAgain", false],
    ["proposed", "deploy.discardProposal", true],
    ["live", "deploy.discardProposal", false],
    ["pending", "deploy.showProgress", true],
    ["idle", "deploy.showProgress", false],
  ];
  test.each(cases)("in %s, %s is enabled: %s, and says why not", (phase, id, ok) => {
    seedStudio();
    seedDeployState({ phase });
    const state = commandState({ id: id as "deploy.keepWaiting" });
    expect(state.ok).toBe(ok);
    if (!state.ok) expect(state.reason).toMatch(/\.$/);
  });

  test("Sign & deploy needs a passed simulation, and reads Sign again after a rejection", () => {
    seedStudio();
    seedDeployState({ phase: "idle" });
    expect(commandState({ id: "deploy.sign" })).toMatchObject({ ok: false, reason: "Open the deploy review first.", title: "Sign & deploy" });
    seedDeployState({ phase: "simulating" });
    expect(commandState({ id: "deploy.sign" })).toMatchObject({ ok: false, reason: "Simulating…" });
    seedDeployState({ phase: "review", error: "You canceled in your wallet.", simulation: { ok: true, block: 1 } });
    expect(commandState({ id: "deploy.sign" }).title).toBe("Sign again");
    // Spec L575: an RPC that can't simulate at all asks for the review's extra tick, not a passing simulation.
    const cant = "Sepolia's RPC can't simulate this deploy. Signing without a simulation needs one more tick.";
    seedDeployState({ phase: "review", chainId: SEPOLIA, error: cant, simulation: { ok: false, unavailable: true } });
    expect(commandState({ id: "deploy.sign" })).toMatchObject({ ok: false, reason: cant });
    seedDeployState({ phase: "review", chainId: SEPOLIA, simulation: { ok: false, unavailable: true } });
    expect(commandState({ id: "deploy.sign" })).toMatchObject({
      ok: false, reason: "This chain's RPC can't simulate this deploy. Signing without a simulation needs one more tick.",
    });
  });

  test("a read-only tab can't sign or deploy missing contracts, and says why", () => {
    const reason = "Another tab is editing this project.";
    seedStudio({ session: { readOnly: reason, chainId: SEPOLIA } });
    seedDeployState({ phase: "ready", simulation: { ok: true, block: 1 } });
    expect(commandState({ id: "deploy.sign" })).toMatchObject({ ok: false, reason });
    expect(commandState({ id: "deploy.missingContracts", args: { names: ["ERC20"] } })).toMatchObject({ ok: false, reason });
    // Tracking commands stay available: the second tab keeps following the deploy.
    seedDeployState({ phase: "pending", chainId: SEPOLIA });
    expect(commandState({ id: "deploy.showProgress" }).ok).toBe(true);
  });

  test("Deploy missing contracts… needs a chain and something missing, then opens the sub-step", async () => {
    seedStudio();
    expect(commandState({ id: "deploy.missingContracts" })).toMatchObject({ ok: false, reason: "Choose a chain first." });
    session.set({ chainId: SEPOLIA });
    expect(commandState({ id: "deploy.missingContracts" })).toMatchObject({ ok: false, reason: "Nothing this recipe needs is missing on this chain." });
    const ref = { id: "deploy.missingContracts" as const, args: { names: ["ERC20"] } };
    expect(commandState(ref).ok).toBe(true);
    await runCommand(ref, "fix");
    expect(session.get().dialogs.at(-1)).toMatchObject({ id: "missing-contracts", props: { chainId: SEPOLIA, names: ["ERC20"] } });
  });

  test("Show deploy progress reopens the review at its progress, or says the review isn't built", async () => {
    seedStudio();
    seedDeployState({ phase: "pending", chainId: SEPOLIA });
    await runCommand({ id: "deploy.showProgress" }, "button");
    expect(bufferedServices().log.at(-1)?.text).toBe("Not built yet · WP-S8b");
    onCleanup(registerDialog("deploy-review", () => null));
    await runCommand({ id: "deploy.showProgress" }, "button");
    expect(session.get().dialogs.at(-1)).toMatchObject({ id: "deploy-review", props: { at: "progress", chainId: SEPOLIA } });
  });
});

describe("the controller behind deployController()", () => {
  function Phase() {
    return <output>{useDeployState((s) => s.phase)}</output>;
  }

  test("loads S8c's machine and mirrors its state for the title block, the chip and the console", async () => {
    const catalog = fixtureCatalog();
    const project = makeProject({ id: "p-mirror", recipe: makeRecipe({}, catalog) });
    const h = deployHarness({ catalog, project });
    onCleanup(setAppDeployMachine(createDeployMachine(h.deps)));
    const screen = await renderWithStudio(<Phase />);
    const controller = await deployController();
    controller.proposed({ safe: SAFE, chainId: SEPOLIA, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", salt: `0x${"00".repeat(32)}` });
    await expect.element(screen.getByRole("status")).toHaveTextContent("proposed");
    expect(deployState()).toMatchObject({ phase: "proposed", safe: SAFE });
  });

  test("over the app's services: records go to the deployments service and lines to the console", async () => {
    const { project } = seedStudio({ chain: true });
    const machine = createDeployMachine(appDeployDeps());
    onCleanup(() => machine.dispose());
    machine.proposed({ safe: SAFE, chainId: SEPOLIA, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", salt: `0x${"00".repeat(32)}` });
    await vi.waitFor(() => expect(bufferedServices().log.map((l) => l.text)).toContain(
      "Proposed to Safe 0x71C7…976F on Sepolia. Waiting for the Safe to execute the batch.",
    ));
    const records: Deployment[] = await listDeployments(project.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ status: "proposed", deployer: SAFE, chainId: SEPOLIA });
  });
});

describe("resume after a reload", () => {
  test("a record with work to do loads the controller; settled records don't", async () => {
    const { project } = seedStudio();
    const loader = vi.fn(async (): Promise<DeployController> => ({ state: () => ({ phase: "idle" }), subscribe: () => () => {} }) as unknown as DeployController);
    onCleanup(provideDeployController(loader));
    const base: Deployment = {
      projectId: project.id, chainId: SEPOLIA, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", path: "factory", deployer: SAFE,
      salt: `0x${"00".repeat(32)}`, status: "confirmed", recipeHash: `0x${"11".repeat(32)}`, catalogHash: `0x${"22".repeat(32)}`,
      at: "2026-09-23T12:00:00.000Z", verification: "pending", revision: 1,
    };
    expect(needsController([base])).toBe(false);
    expect(needsController([{ ...base, status: "pending", tx: `0x${"33".repeat(32)}` }])).toBe(true);
    expect(needsController([{ ...base, fromFile: true }])).toBe(true);
    expect(needsController([{ ...base, status: "proposed" }])).toBe(true);
    await putDeployment(base);
    onCleanup(startDeployTracking());
    await flush();
    expect(loader).not.toHaveBeenCalled();
    await putDeployment({ ...base, address: "0x1111111111111111111111111111111111111111", status: "pending", tx: `0x${"33".repeat(32)}` });
    await flush();
    await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(1));
  });
});

describe("the sheet leaving what's live (spec L728)", () => {
  test("an edit that moves the recipe hash off a live record's says so in the console", async () => {
    const { project } = seedStudio();
    const live = { ...getAnalysis(), recipeHash: `0x${"aa".repeat(32)}` as const };
    onCleanup(provideAnalysis({ getAnalysis: () => live, subscribe: () => () => {} }));
    await putDeployment({
      projectId: project.id, chainId: SEPOLIA, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", path: "factory",
      deployer: SAFE, salt: `0x${"00".repeat(32)}`, status: "confirmed", recipeHash: live.recipeHash,
      catalogHash: `0x${"22".repeat(32)}`, at: "2026-09-23T12:00:00.000Z", verification: "exact_match", revision: 1,
    });
    onCleanup(startDivergenceWatch());
    await flush();
    const edited = { ...live, recipeHash: `0x${"bb".repeat(32)}` as const };
    onCleanup(provideAnalysis({ getAnalysis: () => edited, subscribe: () => () => {} }));
    await vi.waitFor(() => expect(bufferedServices().log.map((l) => l.text)).toContain("The sheet now differs from what's live on Sepolia (r1)."));
  });
});
