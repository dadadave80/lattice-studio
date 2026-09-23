import type { Deployment, Hex } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import {
  command, commandState, doc, getCommand, history, putDeployment, runCommand, session, type CommandContext,
} from "@/contracts";
import { handleKeyDown } from "@/commands/keys/dispatcher";
import { FIXTURE_CATALOG } from "@/chain/infra";
import { NEEDS_WALLET, predict, prediction } from "@/state";
import { DialogHost } from "@/ui";
import {
  bufferedServices, fakeChainService, onCleanup, overrideCommands, renderWithStudio, seedDeployState, type StudioOptions,
} from "../../../test/harness";
import { reviewState } from "./review-state";
import {
  ALICE, SEPOLIA, account, deployableCatalog, fakeDeployController, goOffline, installController, installFees, templateProject,
} from "./test-support";

/** Renders the dialog host with a connected account on Sepolia (the chain served before the session selects it). */
async function studio(options: StudioOptions & { wallet?: boolean } = {}) {
  const catalog = options.catalog === undefined ? deployableCatalog() : options.catalog;
  const chain = fakeChainService({ account: options.wallet === false ? null : account(), ...(catalog ? { catalog } : {}) });
  chain.install();
  installController(fakeDeployController());
  installFees();
  const { wallet: _wallet, ...rest } = options;
  await renderWithStudio(<DialogHost />, { project: templateProject("ERC20"), ...rest, catalog, session: { chainId: SEPOLIA, ...options.session } });
  return chain;
}

function reason(id: Parameters<typeof getCommand>[0], source: "button" | "keys" = "button", args?: Record<string, unknown>) {
  const state = commandState(args ? { id, args: args as never } : { id }, source);
  return state.ok ? null : state.reason;
}

function lastLog(): string | undefined {
  return bufferedServices().log.at(-1)?.text;
}

async function predicted(): Promise<string> {
  await expect.poll(() => prediction().status).toBe("ready");
  const p = prediction();
  return p.status === "ready" ? p.address : "";
}

describe("deploy.open (Flow 12 step 1, IR L13)", () => {
  test("is Deploy… on ⌘/Ctrl+Enter, in the palette and as console `deploy [chain]`", () => {
    const open = getCommand("deploy.open");
    expect(open.title({})).toBe("Deploy…");
    expect(open.keys).toEqual(["Mod+Enter"]);
    expect(open.palette).toBe(true);
    expect(open.console?.parse(["base", "sepolia"])).toEqual({ ok: true, value: { chainId: 84532 } });
    expect(open.console?.parse([])).toEqual({ ok: true, value: {} });
    expect(open.console?.parse(["mainnet"]).ok).toBe(false);
  });

  test("opens the review when nothing blocks", async () => {
    await studio();
    await runCommand({ id: "deploy.open" }, "palette");
    await expect.element(page.getByRole("dialog", { name: "Deploy ERC20" })).toBeVisible();
    expect(session.get().dialogs.map((d) => [d.id, d.props])).toEqual([["deploy-review", { at: "review" }]]);
  });

  test("a fixture catalog can't deploy (contracts §4)", async () => {
    const { fixtureCatalog } = await import("../../../test/harness");
    await studio({ catalog: fixtureCatalog(), project: makeProject({ recipe: templateProject("ERC20").recipe }) });
    expect(reason("deploy.open")).toBe(FIXTURE_CATALOG);
  });

  test("offline it's disabled with its reason, and ⌘/Ctrl+Enter only announces it", async () => {
    goOffline();
    await studio();
    expect(reason("deploy.open")).toBe("Deploy needs a connection");
    handleKeyDown(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", ctrlKey: true }), "other");
    await expect.poll(() => bufferedServices().announce.at(-1)?.[0]).toBe("Deploy needs a connection");
    expect(session.get().dialogs).toEqual([]);
  });

  test("with blockers the button says why, and ⌘/Ctrl+Enter jumps to the first blocker instead", async () => {
    const focused: string[] = [];
    overrideCommands([
      command({
        id: "problem.focus",
        title: () => "Go to problem",
        category: "Build",
        enabled: () => ({ ok: true }),
        run: (_ctx: CommandContext, args) => {
          focused.push(String(args.problemId));
        },
      }),
    ]);
    await studio({ project: makeProject({ recipe: makeRecipe({}, deployableCatalog()) }) });
    expect(reason("deploy.open")).toBe("Resolve 1 blocker · F8");
    expect(commandState({ id: "deploy.open" }, "button")).toMatchObject({ fix: { id: "problem.next" } });
    expect(reason("deploy.open", "keys")).toBeNull();
    const outcome = handleKeyDown(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", ctrlKey: true }), "other");
    expect(outcome).toEqual({ ran: { id: "deploy.open" } });
    await expect.poll(() => focused).toEqual(["CORE-01:0x7a0ed627"]);
    expect(bufferedServices().announce.map(([text]) => text)).toContain("The loupe is incomplete: `facets()` is missing. Every Lattice diamond needs all four.");
    expect(session.get().dialogs).toEqual([]);
  });

  test("while a deploy is in flight it reopens the review at its progress; a Safe proposal disables it (spec L385)", async () => {
    await studio();
    seedDeployState({ phase: "pending", chainId: SEPOLIA });
    await runCommand({ id: "deploy.open" }, "button");
    expect(session.get().dialogs.map((d) => d.props)).toEqual([{ at: "progress" }]);
    seedDeployState({ phase: "proposed", chainId: SEPOLIA });
    expect(reason("deploy.open")).toBe("Waiting for the Safe to execute the batch");
  });

  test("`deploy base sepolia` selects that chain first", async () => {
    await studio();
    await runCommand({ id: "deploy.open", args: { chainId: 84532 } }, "console");
    expect(session.get().chainId).toBe(84532);
    expect(session.get().dialogs.map((d) => d.id)).toEqual(["deploy-review"]);
  });
});

describe("deploy.again (Flow 13)", () => {
  const record = (patch: Partial<Deployment>): Deployment => ({
    projectId: "test-project", chainId: SEPOLIA, address: "0x5FbDB2315678afecb367f032d93F642f64180aa3", path: "factory",
    deployer: ALICE, salt: `0x${"00".repeat(32)}`, status: "confirmed", recipeHash: `0x${"11".repeat(32)}`,
    catalogHash: deployableCatalog().hash, at: "2026-09-23T12:00:00.000Z", verification: "exact_match", revision: 1, ...patch,
  });

  test("after a confirmed deploy it draws new salt entropy, outside history, and opens a fresh review", async () => {
    await studio();
    await putDeployment(record({}));
    const before = doc.get().deploy.entropy;
    const address = await predicted();
    await runCommand({ id: "deploy.again" }, "button");
    const after = doc.get().deploy.entropy;
    expect(after).not.toBe(before);
    expect(after).toMatch(/^0x[0-9a-f]{22}$/);
    expect(history.canUndo).toBe(false);
    expect(await predicted()).not.toBe(address);
    expect(lastLog()).toMatch(/^Drew a new salt for a new diamond\. This diamond would deploy to 0x[0-9a-fA-F]{40}\.$/);
    expect(session.get().dialogs.map((d) => [d.id, d.props])).toEqual([["deploy-review", { at: "review" }]]);
    await expect.element(page.getByRole("dialog", { name: "Deploy ERC20" })).toBeVisible();
  });

  test("with nothing confirmed the salt stays and it says so", async () => {
    await studio();
    await putDeployment(record({ status: "pending" }));
    const before = doc.get().deploy.entropy;
    await runCommand({ id: "deploy.again" }, "button");
    expect(doc.get().deploy.entropy).toBe(before);
    expect(bufferedServices().log.map((l) => l.text)).toContain("Nothing is live yet, so the salt stays as it is.");
  });
});

describe("the review's own commands", () => {
  test("Use a new salt draws entropy through doc.record and says where the diamond goes now", async () => {
    await studio();
    const address = await predicted();
    await runCommand({ id: "deploy.newSalt" }, "button");
    const now = await predicted();
    expect(now).not.toBe(address);
    expect(lastLog()).toBe(`Drew a new salt. This diamond would deploy to ${now}.`);
    expect(history.canUndo).toBe(false);
  });

  test("Use CreateX instead · Use LatticeFactory switch the path; the scope applies on CreateX only", async () => {
    await studio();
    expect(getCommand("deploy.usePath").title({ path: "createx" })).toBe("Use CreateX instead");
    expect(getCommand("deploy.usePath").title({ path: "factory" })).toBe("Use LatticeFactory");
    expect(reason("deploy.setScope", "button", { scope: "this-chain" })).toBe("The scope applies only on the CreateX path");
    await runCommand({ id: "deploy.usePath", args: { path: "createx" } }, "button");
    expect(doc.get().deploy.path).toBe("createx");
    expect(lastLog()).toMatch(/^The diamond deploys through CreateX CREATE3 now\./);
    await runCommand({ id: "deploy.usePath", args: { path: "createx" } }, "button");
    expect(lastLog()).toBe("The diamond already deploys through CreateX.");
    await runCommand({ id: "deploy.setScope", args: { scope: "this-chain" } }, "button");
    expect(doc.get().deploy.scope).toBe("this-chain");
    expect(lastLog()).toMatch(/^Salt scope: this chain only\./);
    expect(history.canUndo).toBe(false);
  });

  test("Preview for another account… shows where it would deploy, without connecting it", async () => {
    await studio();
    const safe = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
    await runCommand({ id: "deploy.previewFor", args: { address: safe } }, "button");
    const expected = predict({ deploy: doc.get().deploy, catalog: deployableCatalog(), chainId: SEPOLIA, account: { address: safe } });
    if (expected.status !== "ready") throw new Error("expected a prediction");
    expect(reviewState().preview).toEqual({ account: safe, result: { ok: true, address: expected.address, chainId: SEPOLIA } });
    expect(lastLog()).toBe(`Deployed by 0x71C7…976F, this diamond would be at ${expected.address} on Sepolia.`);
    expect(reason("deploy.previewFor", "button", { address: "0x12" })).toBe("Enter an address to preview, such as a Safe");
  });

  test("Copy address copies the predicted address in full, or says it needs a wallet", async () => {
    const spy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    onCleanup(() => spy.mockRestore());
    await studio();
    const address = await predicted();
    await runCommand({ id: "deploy.copyAddress" }, "button");
    expect(spy).toHaveBeenCalledWith(address);
  });

  test("Copy address without a wallet says why", async () => {
    await studio({ wallet: false });
    expect(reason("deploy.copyAddress")).toBe(NEEDS_WALLET);
  });

  test("Remove facets… opens its dialog", async () => {
    await studio();
    await runCommand({ id: "deploy.removeFacets" }, "button");
    expect(session.get().dialogs.map((d) => [d.id, d.props])).toEqual([["remove-facets", { chainId: SEPOLIA }]]);
  });

  test("Choose another chain opens the review and moves focus to its chain picker", async () => {
    await studio();
    await runCommand({ id: "chain.focusPicker" }, "fix");
    const dialog = page.getByRole("dialog", { name: "Deploy ERC20" });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByRole("combobox", { name: "Chain" })).toHaveFocus();
  });

  test("Download Transaction Builder batch saves the Safe's batch and records it as Proposed", async () => {
    const safe = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
    const chain = fakeChainService({ account: account({ address: safe, kind: "safe" }), catalog: deployableCatalog() });
    chain.install();
    const controller = fakeDeployController();
    installController(controller);
    installFees();
    const created = vi.spyOn(URL, "createObjectURL");
    onCleanup(() => created.mockRestore());
    await renderWithStudio(<DialogHost />, { project: templateProject("ERC20"), catalog: deployableCatalog(), session: { chainId: SEPOLIA } });
    // The template's example values need acknowledging for the review, not for the batch: no blockers.
    await runCommand({ id: "deploy.downloadSafeBatch" }, "button");
    await expect.poll(() => controller.methods()).toContain("proposed");
    const [batch] = controller.calls.find((c) => c.method === "proposed")?.args ?? [];
    const expected = predict({ deploy: doc.get().deploy, catalog: deployableCatalog(), chainId: SEPOLIA, account: { address: safe } });
    if (expected.status !== "ready") throw new Error("expected a prediction");
    expect(batch).toEqual({ safe, chainId: SEPOLIA, address: expected.address, salt: expected.salt as Hex });
    expect(created).toHaveBeenCalled();
    expect(lastLog()).toMatch(/^Saved .+\.safe\.json\. Import it in the Safe's Transaction Builder/);
  });

  test("Download Transaction Builder batch with an account that isn't a Safe says so", async () => {
    await studio();
    await runCommand({ id: "deploy.downloadSafeBatch" }, "button");
    expect(lastLog()).toBe("The connected account isn't a Safe. Export → Safe batch takes any Safe's address.");
  });
});
