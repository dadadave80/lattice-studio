import type { Address, CommandId, Deployment, Hex, Project, Recipe } from "@lattice-studio/core";
import { analyze, formatAddress, loadTemplate, NotImplemented } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { command, provideServices, putDeployment } from "@/contracts";
import {
  bufferedServices, fakeChainService, fixtureCatalog, onCleanup, overrideCommands, renderWithStudio,
} from "../../../../../test/harness";
import { DiamondView } from "./DiamondView";

const SEPOLIA = 11155111;
const BASE_SEPOLIA = 84532;
const SAFE: Address = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

function template(name: string): Recipe {
  const loaded = loadTemplate(fixtureCatalog(), name);
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

function hashOf(recipe: Recipe): Hex {
  return analyze(recipe, fixtureCatalog()).recipeHash;
}

/** A spy behind `id`, enabled, so the view's button runs it instead of the real (or placeholder) command. */
function spyOn(id: CommandId) {
  const run = vi.fn();
  overrideCommands([command({ id, title: () => id, category: "Build", enabled: () => ({ ok: true }), run })]);
  return run;
}

function argsOf(run: ReturnType<typeof vi.fn>): unknown {
  return run.mock.calls[0]?.[1];
}

function address(byte: string): Address {
  return `0x${byte.repeat(20)}` as Address;
}

function record(projectId: string, patch: Partial<Deployment>): Deployment {
  return {
    projectId,
    chainId: SEPOLIA,
    address: address("a1"),
    path: "factory",
    deployer: address("d0"),
    salt: `0x${"00".repeat(32)}`,
    status: "confirmed",
    recipeHash: `0x${"11".repeat(32)}`,
    catalogHash: `0x${"22".repeat(32)}`,
    at: "2026-09-20T12:00:00.000Z",
    verification: "exact_match",
    revision: 1,
    ...patch,
  };
}

function goOffline(): void {
  onCleanup(provideServices({ connection: { isOnline: () => false, subscribe: () => () => {} } }));
}

const view = <DiamondView view={{ kind: "diamond" }} />;

describe("DiamondView: an empty sheet", () => {
  test("says No facets yet and offers the starting points", async () => {
    const load = spyOn("recipe.load");
    const browse = spyOn("recipe.browse");
    await renderWithStudio(view, { project: makeProject({ id: "empty-1", name: "My diamond" }) });

    await expect.element(page.getByRole("heading", { name: "My diamond" })).toBeVisible();
    await expect.element(page.getByText("Assembly")).toBeVisible();
    await expect.element(page.getByText("No facets yet")).toBeVisible();

    await page.getByRole("button", { name: "Blank diamond (core only)" }).click();
    expect(argsOf(load)).toEqual({ name: "Blank diamond" });
    await page.getByRole("button", { name: "GovernedVault" }).click();
    expect(load.mock.calls[1]?.[1]).toEqual({ name: "GovernedVault" });
    // The first three loadable templates of the fixture catalog.
    await expect.element(page.getByRole("button", { name: "ERC20", exact: true })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "SafeDiamondCut" })).toBeVisible();
    await page.getByRole("button", { name: "Browse all recipes" }).click();
    expect(browse).toHaveBeenCalledTimes(1);

    // The rest of the view still shows.
    await expect.element(page.getByText("Not deployed yet.")).toBeVisible();
    await expect.element(page.getByText("Choose a chain to check readiness.")).toBeVisible();
    await expect.element(page.getByText("Recipe hash")).not.toBeInTheDocument();
  });
});

describe("DiamondView: summary, actions and authority", () => {
  test("summarizes the GovernedVault recipe", async () => {
    const recipe = template("GovernedVault");
    await renderWithStudio(view, { project: makeProject({ id: "gv-summary", name: "GovernedVault", recipe }) });
    const rows = page.getByRole("region", { name: "Summary" });

    await expect.element(rows.getByText(hashOf(recipe))).toBeVisible();
    await expect.element(rows.getByText("fixture", { exact: true })).toBeVisible();
    await expect.element(rows.getByText("14", { exact: true })).toBeVisible();
    await expect.element(rows.getByText("120 routed · 143 exported · 0 excluded")).toBeVisible();
    await expect.element(rows.getByText("1 blocker · 1 warning")).toBeVisible();
    await expect.element(rows.getByText("11 namespaces · disjoint")).toBeVisible();
    await expect.element(rows.getByText("lattice.storage.GovernedVault")).toBeVisible();
    await expect.element(rows.getByText("GovernedVaultInit (bundle) · 1 required argument missing")).toBeVisible();
  });

  test("Fill in, Next problem and Tidy run their commands", async () => {
    const fill = spyOn("init.open");
    const next = spyOn("problem.next");
    const tidy = spyOn("layout.tidy");
    await renderWithStudio(view, { project: makeProject({ id: "gv-actions", recipe: template("GovernedVault") }) });

    await page.getByRole("button", { name: "Fill in" }).click();
    await page.getByRole("button", { name: "Next problem" }).click();
    await page.getByRole("button", { name: "Tidy" }).click();
    expect(fill).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(tidy).toHaveBeenCalledTimes(1);
  });

  test("Fill in hides when no required argument is missing", async () => {
    await renderWithStudio(view, { project: makeProject({ id: "erc20-actions", recipe: template("ERC20") }) });
    await expect.element(page.getByRole("button", { name: "Next problem" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Fill in" })).not.toBeInTheDocument();
    await expect.element(page.getByText("2 steps", { exact: true })).toBeVisible();
  });

  test("lists who holds each role: This diamond, anyone, none", async () => {
    const choose = spyOn("authority.chooseMechanism");
    await renderWithStudio(view, { project: makeProject({ id: "gv-authority", recipe: template("GovernedVault") }) });
    const authority = page.getByRole("region", { name: "Authority" });

    await expect.element(authority.getByText("DEFAULT_ADMIN_ROLE")).toBeVisible();
    expect(authority.getByText("This diamond", { exact: true }).elements()).toHaveLength(3);
    await expect.element(authority.getByText("anyone", { exact: true })).toBeVisible();
    await expect.element(authority.getByText("none", { exact: true })).toBeVisible();
    await expect.element(authority.getByText("GovernedDiamondCut (governance through the timelock)")).toBeVisible();
    await authority.getByRole("button", { name: "Change who can upgrade…" }).click();
    expect(choose).toHaveBeenCalledTimes(1);
  });

  test("an acknowledged immutable recipe says so on the upgrade row", async () => {
    const recipe: Recipe = { ...template("ERC20"), immutable: true };
    await renderWithStudio(view, { project: makeProject({ id: "immutable-authority", recipe }) });
    const authority = page.getByRole("region", { name: "Authority" });
    await expect.element(authority.getByText("Immutable (acknowledged)")).toBeVisible();
    await expect.element(authority.getByText("none", { exact: true })).not.toBeInTheDocument();
  });

  test("shows Deploying account and an address holder in full", async () => {
    const base = template("SafeDiamondCut");
    if (base.init.kind !== "steps" || !base.init.steps[0]) throw new Error("SafeDiamondCut has steps");
    const [first, ...rest] = base.init.steps;
    const recipe: Recipe = {
      ...base,
      init: { kind: "steps", steps: [{ ...first, args: { ...first.args, safe: SAFE } }, ...rest] },
    };
    await renderWithStudio(view, { project: makeProject({ id: "safe-authority", recipe }) });
    const authority = page.getByRole("region", { name: "Authority" });

    await expect.element(authority.getByText("Deploying account")).toBeVisible();
    await expect.element(authority.getByText(SAFE)).toBeVisible();
  });
});

describe("DiamondView: chain readiness", () => {
  test("no chain: offers Choose a chain", async () => {
    const pick = spyOn("chain.focusPicker");
    await renderWithStudio(view, { project: makeProject({ id: "ready-none" }) });
    await expect.element(page.getByText("Choose a chain to check readiness.")).toBeVisible();
    await page.getByRole("button", { name: "Choose a chain" }).click();
    expect(pick).toHaveBeenCalledTimes(1);
  });

  test("offline: says chain checks need a connection", async () => {
    goOffline();
    await renderWithStudio(view, { project: makeProject({ id: "ready-offline" }), session: { chainId: SEPOLIA }, chain: true });
    await expect.element(page.getByText("Chain checks need a connection.")).toBeVisible();
  });

  test("the chain module isn't available: says why", async () => {
    onCleanup(provideServices({ chain: () => Promise.reject(new NotImplemented("S8a", "chainService")) }));
    await renderWithStudio(view, { project: makeProject({ id: "ready-unavailable" }), session: { chainId: SEPOLIA } });
    await expect.element(page.getByText("Not built yet · WP-S8a")).toBeVisible();
  });

  test("not probed yet: Not checked yet.", async () => {
    await renderWithStudio(view, { project: makeProject({ id: "ready-unknown" }), session: { chainId: SEPOLIA }, chain: true });
    await expect.element(page.getByText("Not checked yet.")).toBeVisible();
  });

  test("checking: Checking Sepolia…", async () => {
    const chain = { ...fakeChainService(), readiness: () => ({ status: "checking" }) as const };
    await renderWithStudio(view, { project: makeProject({ id: "ready-checking" }), session: { chainId: SEPOLIA }, chain });
    await expect.element(page.getByText("Checking Sepolia…")).toBeVisible();
  });

  test("error: says so, with Retry reading Sepolia and Use another RPC…", async () => {
    const retry = spyOn("chain.retryRead");
    const another = spyOn("chain.useAnotherRpc");
    const chain = fakeChainService({ down: [SEPOLIA] });
    await chain.probe(SEPOLIA);
    await renderWithStudio(view, { project: makeProject({ id: "ready-error" }), session: { chainId: SEPOLIA }, chain });

    await expect.element(page.getByText("Couldn't read Sepolia: the RPC didn't answer.")).toBeVisible();
    await page.getByRole("button", { name: "Retry reading Sepolia" }).click();
    await page.getByRole("button", { name: "Use another RPC…" }).click();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(another).toHaveBeenCalledTimes(1);
  });

  test("ready: the probes, the placed facets on the chain and simulation", async () => {
    const chain = fakeChainService();
    await renderWithStudio(view, {
      project: makeProject({ id: "ready-rows", recipe: template("GovernedVault") }),
      session: { chainId: SEPOLIA },
      chain,
    });
    await chain.probe(SEPOLIA);
    const readiness = page.getByRole("region", { name: "Chain readiness" });

    await expect.element(readiness.getByText("Arachnid's proxy present")).toBeVisible();
    await expect.element(readiness.getByText("LatticeFactory present")).toBeVisible();
    await expect.element(readiness.getByText("LatticeRegistry present")).toBeVisible();
    await expect.element(readiness.getByText("present", { exact: true })).toBeVisible();
    await expect.element(readiness.getByText("14 of 14 on Sepolia")).toBeVisible();
    await expect.element(readiness.getByText("eth_simulateV1")).toBeVisible();
  });

  test("ready: missing contracts, CreateX on the CreateX path, eth_call only", async () => {
    const chain = fakeChainService({
      state: {
        [SEPOLIA]: {
          simulate: false,
          deployer: { present: false },
          shared: { ERC20: { present: true }, Votes: { present: true } },
        },
      },
    });
    await chain.probe(SEPOLIA);
    const project = makeProject({ id: "ready-createx", recipe: template("GovernedVault") });
    await renderWithStudio(view, {
      project: { ...project, deploy: { ...project.deploy, path: "createx" } },
      session: { chainId: SEPOLIA },
      chain,
    });
    const readiness = page.getByRole("region", { name: "Chain readiness" });

    await expect.element(readiness.getByText("Arachnid's proxy missing")).toBeVisible();
    await expect.element(readiness.getByText("CreateX present")).toBeVisible();
    await expect.element(readiness.getByText("LatticeRegistry missing")).toBeVisible();
    await expect.element(readiness.getByText("2 of 14 on Sepolia")).toBeVisible();
    await expect.element(readiness.getByText("eth_call only")).toBeVisible();
  });
});

describe("DiamondView: deployments", () => {
  test("Not deployed yet.", async () => {
    await renderWithStudio(view, { project: makeProject({ id: "deploy-none" }), chain: true });
    await expect.element(page.getByText("Not deployed yet.")).toBeVisible();
  });

  test("Checking 2 deployments… while the reads are in flight", async () => {
    const chain = { ...fakeChainService(), codeAt: () => new Promise<never>(() => {}) };
    await putDeployment(record("deploy-checking", { address: address("b1") }));
    await putDeployment(record("deploy-checking", { address: address("b2") }));
    // deployments.show (the status chip) asked for the list: its records are read on the chain.
    await renderWithStudio(<DiamondView view={{ kind: "diamond", section: "deployments" }} />, {
      project: makeProject({ id: "deploy-checking" }),
      chain,
    });
    await expect.element(page.getByText("Checking 2 deployments…")).toBeVisible();
  });

  test("records are read only on request, and each read says what it found", async () => {
    const found = address("e1");
    const empty = address("e2");
    const chain = fakeChainService({ code: { [found]: "0x6080" } });
    await putDeployment(record("deploy-on-request", { address: found }));
    await putDeployment(record("deploy-on-request", { address: empty, at: "2026-09-21T12:00:00.000Z" }));
    await renderWithStudio(view, { project: makeProject({ id: "deploy-on-request" }), chain });
    const check = page.getByRole("button", { name: "Check 2 deployments on chain" });
    await expect.element(check).toBeVisible();
    expect(chain.calls.filter((call) => call.method === "codeAt")).toHaveLength(0);
    await check.click();
    await expect.element(page.getByText("Code found on Sepolia.")).toBeVisible();
    await expect.element(page.getByText("No code at this address on Sepolia.")).toBeVisible();
    expect(chain.calls.filter((call) => call.method === "codeAt")).toHaveLength(2);
  });

  test("offline: no reads, the records as stored", async () => {
    goOffline();
    const chain = fakeChainService();
    await putDeployment(record("deploy-offline", { address: address("b3") }));
    await renderWithStudio(view, { project: makeProject({ id: "deploy-offline" }), chain });
    await expect.element(page.getByText(formatAddress(address("b3")))).toBeVisible();
    expect(chain.calls.filter((call) => call.method === "codeAt")).toHaveLength(0);
    await expect.element(page.getByText("Checking 1 deployment…")).not.toBeInTheDocument();
  });

  test("a failed read marks its record; Retry reads it again", async () => {
    const chain = fakeChainService({ down: [SEPOLIA] });
    await putDeployment(record("deploy-down", { address: address("c1") }));
    await renderWithStudio(view, { project: makeProject({ id: "deploy-down" }), chain });
    await page.getByRole("button", { name: "Check 1 deployment on chain" }).click();

    const failure = page.getByText("Couldn't read Sepolia for this record.");
    await expect.element(failure).toBeVisible();
    const reads = () => chain.calls.filter((call) => call.method === "codeAt").length;
    expect(reads()).toBe(1);
    chain.setDown(SEPOLIA, false);
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.element(failure).not.toBeInTheDocument();
    expect(reads()).toBe(2);
  });

  test("groups records by chain, newest first, with status, address, recipe hash and verification", async () => {
    const recipe = template("GovernedVault");
    const current = hashOf(recipe);
    const id = "deploy-groups";
    await putDeployment(record(id, { address: address("d1"), at: "2026-09-20T12:00:00.000Z", recipeHash: current }));
    await putDeployment(
      record(id, { address: address("d2"), chainId: BASE_SEPOLIA, at: "2026-09-22T12:00:00.000Z", verification: "pending" }),
    );
    await putDeployment(
      record(id, { address: address("d3"), at: "2026-09-21T12:00:00.000Z", revision: 2, verification: "match" }),
    );
    await putDeployment(
      record(id, { address: address("d4"), at: "2026-09-19T12:00:00.000Z", fromFile: true, recipeHash: current }),
    );
    await renderWithStudio(view, { project: makeProject({ id, recipe }), chain: true });

    const list = page.getByRole("region", { name: "Deployments" });
    await expect.element(list.getByRole("heading", { name: "Base Sepolia" })).toBeVisible();
    const headings = [...document.querySelectorAll("[data-section='deployments'] h4")].map((h) => h.textContent);
    expect(headings).toEqual(["Base Sepolia", "Sepolia"]);
    const order = [...document.querySelectorAll("[data-record]")].map((li) => li.getAttribute("data-record"));
    expect(order).toEqual([
      `${BASE_SEPOLIA}:${address("d2")}`,
      `${SEPOLIA}:${address("d3")}`,
      `${SEPOLIA}:${address("d1")}`,
      `${SEPOLIA}:${address("d4")}`,
    ]);

    await expect.element(list.getByText("Live · r1")).toBeVisible();
    await expect.element(list.getByText("Confirmed · r2")).toBeVisible();
    await expect.element(list.getByText("From file")).toBeVisible();
    await expect.element(list.getByText("Verifying")).toBeVisible();
    await expect.element(list.getByText("Verified (match)")).toBeVisible();
    expect(list.getByText("Verified (exact match)").elements()).toHaveLength(2);
    await expect.element(list.getByText(formatAddress(address("d1")))).toHaveAttribute("title", formatAddress(address("d1"), { full: true }));
    await expect.element(list.getByText(`recipe ${current.slice(0, 6)}…${current.slice(-4)}`).first()).toBeVisible();
    const link = list.getByRole("link", { name: "Open in explorer" }).first();
    await expect.element(link).toHaveAttribute("href", `https://sepolia.basescan.org/address/${address("d2")}`);
  });

  test("mismatch, proposed and failed verification offer their actions", async () => {
    const compare = spyOn("deploy.compare");
    const discard = spyOn("deploy.discardProposal");
    const reverify = spyOn("deploy.retryVerification");
    const id = "deploy-actions";
    await putDeployment(record(id, { address: address("e1"), status: "mismatch", at: "2026-09-21T00:00:00.000Z" }));
    await putDeployment(record(id, { address: address("e2"), status: "proposed", at: "2026-09-20T00:00:00.000Z" }));
    await putDeployment(record(id, { address: address("e3"), verification: "failed", at: "2026-09-19T00:00:00.000Z" }));
    await renderWithStudio(view, { project: makeProject({ id }), chain: true });

    await expect.element(page.getByText("Mismatch", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Proposed (Safe)")).toBeVisible();
    await expect.element(page.getByText("Couldn't verify")).toBeVisible();

    await page.getByRole("button", { name: "Compare with the sheet…" }).click();
    expect(argsOf(compare)).toEqual({ chainId: SEPOLIA, address: address("e1") });
    await page.getByRole("button", { name: "Discard proposal" }).click();
    expect(discard).toHaveBeenCalledTimes(1);
    await page.getByRole("button", { name: "Retry verification" }).click();
    expect(argsOf(reverify)).toEqual({ chainId: SEPOLIA, address: address("e3") });
  });

  test("Copy address copies the address and says so", async () => {
    const writes = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    onCleanup(() => writes.mockRestore());
    await putDeployment(record("deploy-copy", { address: address("f1") }));
    await renderWithStudio(view, { project: makeProject({ id: "deploy-copy" }), chain: true });

    await page.getByRole("button", { name: "Copy address" }).click();
    await vi.waitFor(() => expect(writes).toHaveBeenCalledWith(formatAddress(address("f1"), { full: true })));
    await vi.waitFor(() => expect(bufferedServices().toast.at(-1)?.text).toBe(`Copied ${formatAddress(address("f1"))}`));
  });
});

describe("DiamondView: unknown fields", () => {
  test("lists the fields Studio kept but doesn't recognize", async () => {
    const recipe = template("ERC20");
    const base = makeProject({ id: "unknown-fields", recipe });
    const project = { ...base, extra: 1, recipe: { ...recipe, note: "x" } } as Project;
    await renderWithStudio(view, { project });

    const section = page.getByRole("region", { name: "Unknown fields" });
    await expect.element(section.getByText("Studio kept 2 fields it doesn't recognize")).toBeVisible();
    const paths = section.getByRole("listitem").elements().map((item) => item.textContent);
    expect(paths).toEqual(expect.arrayContaining(["extra", "recipe.note"]));
  });

  test("shows nothing when every field is known", async () => {
    await renderWithStudio(view, { project: makeProject({ id: "known-fields", recipe: template("ERC20") }) });
    await expect.element(page.getByRole("region", { name: "Authority" })).toBeVisible();
    await expect.element(page.getByRole("region", { name: "Unknown fields" })).not.toBeInTheDocument();
  });
});
