import type { Address, Arg, Project } from "@lattice-studio/core";
import { formatCount, toChecksum } from "@lattice-studio/core";
import { describe, expect, test } from "vitest";
import { getAnalysis } from "@/contracts";
import { resetInitUi, setEnsLabel } from "@/panels/init/init-ui-store";
import { NEEDS_WALLET } from "@/state/prediction";
import { fakeChainService, healthyChainState, onCleanup } from "../../../test/harness";
import {
  ALICE, BASE_SEPOLIA, SEPOLIA, account, deployableCatalog, renderReview, section, templateProject, withRecipe,
} from "./test-support";

const VAULT: Address = toChecksum("0x71c7656ec7ab88b098defb751b7401b5f6d8976f");
const OTHER: Address = toChecksum("0x4b20993bc481177ec7e8f571cecae8a9e22c02db");
const ADMIN: Address = toChecksum("0xab1234567890abcdef1234567890abcdef1234c7");

/** SafeDiamondCut with its one step's arguments patched (a literal Safe clears INIT-01 once it has code). */
function safeCut(args: Record<string, Arg>, patch: Partial<Project> = {}): Project {
  const project = templateProject("SafeDiamondCut", patch);
  const { init } = project.recipe;
  if (init.kind !== "steps" || !init.steps[0]) throw new Error("SafeDiamondCut's template has one step");
  const [step] = init.steps;
  return withRecipe(project, { ...project.recipe, init: { kind: "steps", steps: [{ ...step, args: { ...step.args, ...args } }] } });
}

/** A healthy chain with a connected account and a Safe's code at VAULT. */
function chainWith(options: Parameters<typeof fakeChainService>[0] = {}) {
  return fakeChainService({ account: account(), catalog: deployableCatalog(), code: { [VAULT]: "0x6080" }, ...options });
}

function withLabels() {
  onCleanup(resetInitUi);
}

describe("What gets cut", () => {
  test("summarizes the cut and expands to each facet with its version, full address and LatticeRegistry", async () => {
    const { dialog } = await renderReview({ project: templateProject("ERC20") });
    const cut = section("What gets cut");
    // The core's two Adds are named, not counted: ERC20's template cuts ERC20 and Receive beside them.
    const text = "The core and 2 facets · 15 selectors";
    await expect.element(cut.getByText(text)).toBeVisible();
    await expect.element(cut.getByText("Ready", { exact: true })).toBeVisible();
    await cut.getByText(text).click();
    for (const entry of getAnalysis().plan) {
      const row = cut.getByRole("row").filter({ hasText: `${entry.facet} ${entry.version}` });
      await expect.element(row.getByRole("rowheader", { name: `${entry.facet} ${entry.version}`, exact: true })).toBeVisible();
      await expect.element(row.getByText(toChecksum(entry.address), { exact: true })).toBeVisible();
      await expect.element(row.getByText("Matches")).toBeVisible();
      await expect.element(row.getByText("LatticeRegistry")).toBeVisible();
      // "12/17 selectors", routed of exported, as every count reads (spec L685).
      const exported = deployableCatalog().facets.find((f) => f.name === entry.facet)?.selectors.length ?? 0;
      await expect.element(row.getByText(formatCount(entry.selectors.length, exported), { exact: true })).toBeVisible();
    }
    expect(dialog.element().querySelectorAll("[data-facet]").length).toBe(getAnalysis().plan.length);
  });

  test("names the catalog tag where the registry doesn't list the version", async () => {
    const chain = chainWith({ state: { [SEPOLIA]: { registry: { records: {} } } } });
    await renderReview({ project: templateProject("ERC20"), chain });
    const cut = section("What gets cut");
    await cut.getByText("The core and 2 facets · 15 selectors").click();
    const row = cut.getByRole("row").filter({ hasText: "ERC20 " }).first();
    await expect.element(row.getByText("catalog v0.4.0")).toBeVisible();
  });

  test("marks a differing codehash and blocks deploy", async () => {
    const healthy = healthyChainState(SEPOLIA, "Sepolia", deployableCatalog()).shared;
    const chain = chainWith({
      state: { [SEPOLIA]: { shared: { ...healthy, ERC20: { present: true, codehash: `0x${"ab".repeat(32)}` } } } },
    });
    const { dialog } = await renderReview({ project: templateProject("ERC20"), chain });
    const cut = section("What gets cut");
    await expect.element(cut.getByText("Blocks deploy", { exact: true })).toBeVisible();
    // Open by itself so the blocking row shows.
    await expect.element(cut.getByText("Differs from the catalog")).toBeVisible();
    expect(dialog.element().querySelector('[data-facet="ERC20"]')?.getAttribute("data-check")).toBe("differs");
    // The footer agrees with the section: NET-04 is the one blocker.
    const sign = dialog.getByRole("button", { name: "Sign & deploy" });
    await expect.element(sign).toHaveAccessibleDescription("Resolve 1 blocker · F8");
  });
});

describe("Init", () => {
  test("shows ERC20's decoded arguments", async () => {
    await renderReview({ project: templateProject("ERC20") });
    const init = section("Init");
    await expect.element(init.getByText("ERC20Init · init(string,string)")).toBeVisible();
    await expect.element(init.getByText("Example Token", { exact: true })).toBeVisible();
    await expect.element(init.getByText("EXT", { exact: true })).toBeVisible();
    await expect.element(init.getByText("Ready", { exact: true })).toBeVisible();
  });

  test("shows a reference as the deploying account with its full address", async () => {
    await renderReview({ project: safeCut({ safe: VAULT }), chain: chainWith() });
    const init = section("Init");
    await expect.element(init.getByText("SafeDiamondCutInit · init(address,address,uint256)")).toBeVisible();
    await expect.element(init.getByText(`deploying account (${ALICE})`)).toBeVisible();
    await expect.element(init.getByText(VAULT, { exact: true })).toBeVisible();
    await expect.element(init.getByText("Ready", { exact: true })).toBeVisible();
  });

  test("without a wallet, says why and lists the planned arguments", async () => {
    const chain = chainWith({ account: null });
    await renderReview({ project: safeCut({ safe: VAULT }), chain });
    const init = section("Init");
    await expect.element(init.getByText(NEEDS_WALLET)).toBeVisible();
    await expect.element(init.getByText("deploying account", { exact: true })).toBeVisible();
    await expect.element(init.getByText("Waiting", { exact: true })).toBeVisible();
  });

  test("with an argument missing, lists the planned arguments and blocks", async () => {
    await renderReview({ project: templateProject("GovernedVault") });
    const init = section("Init");
    await expect.element(init.getByText("p.name")).toBeVisible();
    await expect.element(init.getByText("Grant vault", { exact: true })).toBeVisible();
    await expect.element(init.getByText("Blocks deploy", { exact: true })).toBeVisible();
  });

  test("re-resolves an ENS name typed this session and says it still resolves", async () => {
    withLabels();
    const project = safeCut({ safe: VAULT });
    setEnsLabel(project.id, "steps[0].safe", { name: "vault.eth", address: VAULT, chainId: SEPOLIA });
    const chain = chainWith({ ens: { "vault.eth": VAULT } });
    await renderReview({ project, chain });
    const init = section("Init");
    await expect.element(init.getByText(`vault.eth (${VAULT})`)).toBeVisible();
    await expect.element(init.getByText("ENS names are resolved again here.")).toBeVisible();
    await expect.element(init.getByText(`vault.eth still resolves to ${VAULT}.`)).toBeVisible();
    expect(chain.calls.filter((c) => c.method === "resolveEns")).toEqual([{ method: "resolveEns", args: ["vault.eth", SEPOLIA] }]);
    await expect.element(section("Authority after deploy").getByText(`vault.eth (${VAULT})`)).toBeVisible();
  });

  test("flags an ENS name that resolves elsewhere now, with Edit field", async () => {
    withLabels();
    const project = safeCut({ safe: VAULT });
    setEnsLabel(project.id, "steps[0].safe", { name: "vault.eth", address: VAULT, chainId: SEPOLIA });
    await renderReview({ project, chain: chainWith({ ens: { "vault.eth": OTHER } }) });
    const init = section("Init");
    const flag = init.getByText(
      `vault.eth now resolves to ${OTHER}, not ${VAULT} as when it was typed. Edit the field to use the new address.`,
    );
    await expect.element(flag).toBeVisible();
    await expect.element(init.getByRole("img", { name: "Warning" })).toBeVisible();
    await expect.element(init.getByRole("button", { name: "Edit field" })).toBeVisible();
  });

  test("after a reload, a name kept in the project is resolved again and still resolves", async () => {
    withLabels();
    resetInitUi();
    // Nothing typed this session: only the project's own label, as a reload leaves it (spec L462).
    const project = safeCut({ safe: VAULT }, { labels: { "steps[0].safe": "vault.eth" } });
    const chain = chainWith({ ens: { "vault.eth": VAULT } });
    await renderReview({ project, chain });
    const init = section("Init");
    await expect.element(init.getByText(`vault.eth (${VAULT})`)).toBeVisible();
    await expect.element(init.getByText(`vault.eth still resolves to ${VAULT}.`)).toBeVisible();
    expect(chain.calls.filter((c) => c.method === "resolveEns")).toEqual([{ method: "resolveEns", args: ["vault.eth", SEPOLIA] }]);
  });

  test("after a reload, a name kept in the project that resolves elsewhere now is flagged", async () => {
    withLabels();
    resetInitUi();
    const project = safeCut({ safe: VAULT }, { labels: { "steps[0].safe": "vault.eth" } });
    await renderReview({ project, chain: chainWith({ ens: { "vault.eth": OTHER } }) });
    const init = section("Init");
    const flag = init.getByText(`vault.eth now resolves to ${OTHER}, not ${VAULT} as when it was typed. Edit the field to use the new address.`);
    await expect.element(flag).toBeVisible();
    await expect.element(init.getByRole("button", { name: "Edit field" })).toBeVisible();
  });

  test("never resolves a name typed for another chain", async () => {
    withLabels();
    const project = safeCut({ safe: VAULT });
    setEnsLabel(project.id, "steps[0].safe", { name: "vault.eth", address: VAULT, chainId: BASE_SEPOLIA });
    const chain = chainWith({ ens: { "vault.eth": VAULT } });
    await renderReview({ project, chain });
    // The chain module has loaded and read Sepolia, so the recheck effect has had its chance to run.
    await expect.element(section("Network").getByText(/^Sepolia · LatticeFactory ✓/)).toBeVisible();
    const init = section("Init");
    await expect.element(init.getByText(`deploying account (${ALICE})`)).toBeVisible();
    await expect.element(init.getByText(VAULT, { exact: true })).toBeVisible();
    expect(init.getByText("ENS names are resolved again here.").query()).toBeNull();
    expect(chain.calls.some((c) => c.method === "resolveEns")).toBe(false);
  });
});

describe("Authority after deploy", () => {
  test("shows this diamond with its address, anyone and none", async () => {
    await renderReview({ project: templateProject("GovernedVault") });
    const authority = section("Authority after deploy");
    const admin = authority.getByRole("row").filter({ hasText: "DEFAULT_ADMIN_ROLE" });
    await expect.element(admin.getByText(/^this diamond \(0x[0-9a-fA-F]{40}\)$/)).toBeVisible();
    await expect.element(authority.getByRole("row").filter({ hasText: "Executor" }).getByText("anyone", { exact: true })).toBeVisible();
    await expect.element(authority.getByRole("row").filter({ hasText: "Guardian" }).getByText("none", { exact: true })).toBeVisible();
    await expect.element(authority.getByText("Ready", { exact: true })).toBeVisible();
  });

  test("asks for AUTH-01's tick when a single key holds the admin role", async () => {
    await renderReview({ project: safeCut({ admin: ADMIN, safe: VAULT }), chain: chainWith() });
    const authority = section("Authority after deploy");
    await expect.element(authority.getByRole("row").filter({ hasText: "DEFAULT_ADMIN_ROLE" }).getByText(ADMIN, { exact: true })).toBeVisible();
    await expect.element(authority.getByRole("row").filter({ hasText: "Upgrade" }).getByText(VAULT, { exact: true })).toBeVisible();
    await expect.element(authority.getByText("Needs a tick", { exact: true })).toBeVisible();
    await expect.element(authority.getByRole("button", { name: "Use a Safe…" })).toBeVisible();
    await expect.element(authority.getByRole("button", { name: "Use governance…" })).toBeVisible();
    await authority.getByRole("checkbox", { name: "Keep single key" }).click();
    await expect.element(authority.getByText("Ready", { exact: true })).toBeVisible();
  });

  test("blocks on LINK-01 with its fixes", async () => {
    const project = safeCut({ admin: ADMIN, safe: VAULT }, { provenance: { "steps[0].admin": "link" } });
    await renderReview({ project, chain: chainWith() });
    const authority = section("Authority after deploy");
    await expect.element(authority.getByText("Blocks deploy", { exact: true })).toBeVisible();
    await expect.element(authority.getByRole("button", { name: "Confirm address…" })).toBeVisible();
    await expect.element(authority.getByRole("button", { name: "Edit field" })).toBeVisible();
  });
});
