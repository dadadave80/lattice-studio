import type { Arg, Project } from "@lattice-studio/core";
import { createElement, Suspense } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  commandRef, doc, getAnalysis, history, inspectorViewComponent, runCommand, session, useSession, type InspectorView,
} from "@/contracts";
import { bufferedServices, fakeChainService, renderWithStudio } from "../../../test/harness";
import { resetInitUi } from "./init-ui-store";
import { InitEditor } from "./InitEditor";
import { kitchenCatalog, kitchenRecipe, projectFor, SAFE, SOME_CODE, stepsRecipe, templateRecipe, TOKEN } from "./test-support";

afterEach(resetInitUi);

/** What S5c's inspector frame does: render whatever is registered for the session's view. */
function InspectorHost() {
  const view = useSession((s) => s.panes.inspector.view);
  if (!view) return <p>Nothing shown</p>;
  const registered = inspectorViewComponent(view.kind);
  if (!registered) return <p>Nothing shown</p>;
  return <Suspense fallback={<p>Loading…</p>}>{createElement(registered, { view: view as never })}</Suspense>;
}

function showView(view: InspectorView): void {
  session.set((s) => ({ panes: { ...s.panes, inspector: { ...s.panes.inspector, view } } }));
}

function argAt(project: Project, path: string): Arg | undefined {
  const [head, ...keys] = path.split(".");
  const init = project.recipe.init;
  let current: Arg | undefined;
  if (head === "bundle" && init.kind === "bundle") current = init.args;
  const m = /^steps\[(\d+)\]$/.exec(head ?? "");
  if (m && init.kind === "steps") current = init.steps[Number(m[1])]?.args;
  for (const key of keys) current = (current as Record<string, Arg> | undefined)?.[key];
  return current;
}

function lastLog(): string | undefined {
  return bufferedServices().log.at(-1)?.text;
}

/** Narration of the problems an edit resolves follows the edit's own line (S1), so look for it, not at the end. */
function logged(text: string): boolean {
  return bufferedServices().log.some((line) => line.text === text);
}

/** Selects a chain after render, as a person would, so S1's chain mirror loads the test's fake chain service. */
function pickChain(chainId = 11155111): void {
  session.set({ chainId });
}

const vault = () => projectFor(templateRecipe("GovernedVault"));

describe("the bundle form (GovernedVaultInit, spec L460)", () => {
  test("one locked step whose struct shows as nine fields, and the internal order read-only", async () => {
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: vault() });
    await expect.element(page.getByRole("heading", { name: "GovernedVaultInit" })).toBeVisible();
    for (const label of ["Asset", "Name", "Symbol", "Decimals offset", "Min delay", "Voting delay", "Voting period", "Proposal threshold", "Governor quorum"]) {
      await expect.element(page.getByRole("textbox", { name: label, exact: true })).toBeVisible();
    }
    await expect.element(page.getByRole("img", { name: "Locked" })).toBeVisible();
    await expect.element(page.getByRole("heading", { name: "Order inside GovernedVaultInit" })).toBeVisible();
    const order = page.getByRole("list", { name: "Order inside GovernedVaultInit" });
    await expect.element(order).toBeVisible();
    expect(order.element().textContent).toMatch(/^01AccessControl02EmergencyStop.*14GovernedVault$/);
    // A bundle shows its fixed order and none of the step controls (spec L467).
    expect(page.getByRole("button", { name: /^Move / }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: "Reorder steps automatically" }).elements()).toHaveLength(0);
  });

  test("example dots, the missing asset inline, and Fill in focusing it", async () => {
    await renderWithStudio(<InspectorHost />, { project: vault() });
    showView({ kind: "init" });
    const asset = page.getByRole("textbox", { name: "Asset", exact: true });
    await expect.element(asset).toBeVisible();
    // INIT-01 is a by-design blocker here (spec L411): shown inline, as in Problems.
    await expect.element(asset).toHaveAccessibleDescription(/Asset is required\. Fill it in before deploying\./);
    await expect.element(page.getByRole("textbox", { name: "Name", exact: true })).toHaveAccessibleDescription(/^Example/);
    await page.getByRole("button", { name: "Fill in" }).click();
    await expect.element(asset).toHaveFocus();
  });

  test("a field set by hand loses its Example dot and says Set by you", async () => {
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: vault() });
    const name = page.getByRole("textbox", { name: "Name", exact: true });
    await name.fill("My vault");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => argAt(doc.get(), "bundle.p.name")).toBe("My vault");
    await expect.element(name).toHaveAccessibleDescription(/^Set by you/);
    expect(lastLog()).toBe("Set Name to My vault.");
  });
});

describe("field types (spec L461-L466)", () => {
  test("duration: number and unit, stored in seconds, echoed", async () => {
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: vault() });
    const delay = page.getByRole("textbox", { name: "Min delay", exact: true });
    // 300 s reads as 5 minutes; the echo gives the stored seconds.
    await expect.element(delay).toHaveValue("5");
    await expect.element(page.getByRole("combobox", { name: "Min delay unit" })).toHaveTextContent("minutes");
    await expect.element(delay).toHaveAccessibleDescription(/= 300 s/);
    await delay.fill("2");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => argAt(doc.get(), "bundle.p.minDelay")).toBe("120");
    expect(lastLog()).toBe("Set Min delay to 2 minutes (120 s).");

    await page.getByRole("combobox", { name: "Min delay unit" }).click();
    await page.getByRole("option", { name: "seconds" }).click();
    await expect.poll(() => argAt(doc.get(), "bundle.p.minDelay")).toBe("2");
    const voting = page.getByRole("textbox", { name: "Voting period", exact: true });
    await voting.fill("600");
    await page.getByRole("combobox", { name: "Voting period unit" }).click();
    await page.getByRole("option", { name: "seconds" }).click();
    await expect.poll(() => argAt(doc.get(), "bundle.p.votingPeriod")).toBe("600");
    await expect.element(voting).toHaveAccessibleDescription(/= 10 minutes/);
  });

  test("Esc reverts a draft to what's stored; blur commits", async () => {
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: vault() });
    const symbol = page.getByRole("textbox", { name: "Symbol", exact: true });
    await symbol.fill("NOPE");
    await userEvent.keyboard("{Escape}");
    await expect.element(symbol).toHaveValue("gVLT");
    expect(argAt(doc.get(), "bundle.p.symbol")).toBe("gVLT");
    await symbol.fill("VLT");
    await page.getByRole("textbox", { name: "Name", exact: true }).click();
    await expect.poll(() => argAt(doc.get(), "bundle.p.symbol")).toBe("VLT");
  });

  test("percent: 0-100 with the spec's INIT-01 message inline and in Problems", async () => {
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: vault() });
    const quorum = page.getByRole("textbox", { name: "Governor quorum", exact: true });
    await expect.element(quorum).toHaveAccessibleDescription(/Percent, 0-100\./);
    await quorum.fill("140");
    await userEvent.keyboard("{Enter}");
    const message = "Governor quorum is 140; it must be 0-100 (percent of supply).";
    await expect.element(quorum).toHaveAccessibleDescription(new RegExp(message.replace(/[()]/g, "\\$&")));
    await expect.element(quorum).toHaveAttribute("aria-invalid", "true");
    expect(getAnalysis().problems.some((p) => p.code === "INIT-01" && p.message === message)).toBe(true);
  });

  test("token amount in raw wei, stored as a decimal string", async () => {
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: vault() });
    const threshold = page.getByRole("textbox", { name: "Proposal threshold", exact: true });
    await expect.element(threshold).toHaveAccessibleDescription(/In wei\./);
    await threshold.fill("1000000000000000000000");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => argAt(doc.get(), "bundle.p.proposalThreshold")).toBe("1000000000000000000000");
  });

  test("address: paste-friendly, checksummed; a bad checksum stays on the field", async () => {
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: vault() });
    const asset = page.getByRole("textbox", { name: "Asset", exact: true });
    await asset.fill(`  ${TOKEN.toLowerCase()} `);
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => argAt(doc.get(), "bundle.p.asset")).toBe(TOKEN);
    await expect.element(asset).toHaveValue(TOKEN);

    // One letter's case flipped: mixed case that doesn't match EIP-55.
    await asset.fill("0x71c7656EC7ab88b098defB751B7401B5f6d8976F");
    await userEvent.keyboard("{Enter}");
    await expect.element(asset).toHaveAccessibleDescription(/checksum doesn't match, so it may have a typo/);
    expect(argAt(doc.get(), "bundle.p.asset")).toBe(TOKEN);
  });

  test("quick picks store references and show what they resolve to for the current chain and wallet", async () => {
    const chain = fakeChainService({ account: { address: SAFE, chainId: 11155111, connector: "io.metamask" } });
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: projectFor(templateRecipe("SafeDiamondCut")), chain });
    pickChain();
    // SafeDiamondCut's admin is the deploying account by default.
    await expect.element(page.getByText(`Deploying account (${SAFE})`).first()).toBeVisible();
    const pickers = page.getByRole("group", { name: "Safe quick picks" });
    await pickers.getByRole("button", { name: "This diamond" }).click();
    await expect.poll(() => argAt(doc.get(), "steps[0].safe")).toEqual({ $ref: "self" });
    await expect.element(page.getByText(/^This diamond \(0x[0-9a-fA-F]{40}\)$/).first()).toBeVisible();
    // A nonzero rule: no Zero address pick.
    expect(pickers.getByRole("button", { name: "Zero address" }).elements()).toHaveLength(0);
  });

  test("without a chain or wallet a reference says why it doesn't resolve yet", async () => {
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: projectFor(templateRecipe("SafeDiamondCut")) });
    await expect.element(page.getByRole("textbox", { name: "Admin", exact: true })).toBeVisible();
    const row = document.querySelector("[data-init-path='steps[0].admin']")?.textContent ?? "";
    expect(row).toContain("Deploying account: Choose a chain to see the deploy address");
  });

  test("ENS: resolves through the chain service, stores the address and keeps the name as its label", async () => {
    const chain = fakeChainService({ ens: { "safe.eth": SAFE } });
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, {
      project: projectFor(templateRecipe("SafeDiamondCut")),
      session: { chainId: 11155111 },
      chain,
    });
    const safe = page.getByRole("textbox", { name: "Safe", exact: true });
    await safe.fill("safe.eth");
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => argAt(doc.get(), "steps[0].safe")).toBe(SAFE);
    await expect.element(page.getByText(`safe.eth (${SAFE})`)).toBeVisible();
    expect(chain.calls.some((c) => c.method === "resolveEns" && c.args[0] === "safe.eth" && c.args[1] === 11155111)).toBe(true);

    await safe.fill("nobody.eth");
    await userEvent.keyboard("{Enter}");
    await expect.element(safe).toHaveAccessibleDescription(/nobody\.eth doesn't resolve to an address\./);
    expect(argAt(doc.get(), "steps[0].safe")).toBe(SAFE);
  });

  test("ENS offline or with no chain says why, and stores nothing", async () => {
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: projectFor(templateRecipe("SafeDiamondCut")) });
    const safe = page.getByRole("textbox", { name: "Safe", exact: true });
    await safe.fill("safe.eth");
    await userEvent.keyboard("{Enter}");
    await expect.element(safe).toHaveAccessibleDescription(/Choose a chain to resolve ENS names\./);
    expect(argAt(doc.get(), "steps[0].safe")).toBeUndefined();
  });

  test("code-required rules are checked on the selected chain", async () => {
    const chain = fakeChainService({ code: { [TOKEN]: SOME_CODE } });
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: projectFor(templateRecipe("SafeDiamondCut")), chain });
    pickChain();
    const safe = page.getByRole("textbox", { name: "Safe", exact: true });
    await safe.fill(SAFE);
    await userEvent.keyboard("{Enter}");
    await expect.element(safe).toHaveAccessibleDescription(/No Safe at this address on Sepolia yet\. Deploy the Safe first\./);
    expect(chain.calls.some((c) => c.method === "probe")).toBe(true);
  });

  test("booleans, enums, length limits and whole numbers", async () => {
    const catalog = kitchenCatalog();
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: projectFor(kitchenRecipe(catalog)), catalog });
    await page.getByRole("switch", { name: "Paused" }).click();
    await expect.poll(() => argAt(doc.get(), "steps[0].paused")).toBe(true);

    await page.getByRole("combobox", { name: "Tier" }).click();
    await page.getByRole("option", { name: "silver" }).click();
    await expect.poll(() => argAt(doc.get(), "steps[0].tier")).toBe("silver");

    const label = page.getByRole("textbox", { name: "Label", exact: true });
    await expect.element(label).toHaveAccessibleDescription(/Up to 8 characters\./);
    await label.fill("far too long");
    await userEvent.keyboard("{Enter}");
    await expect.element(label).toHaveAccessibleDescription(/Label is far too long; it must be at most 8 characters\./);

    const slots = page.getByRole("textbox", { name: "Slots", exact: true });
    await slots.fill("7");
    await userEvent.keyboard("{ArrowUp}{Enter}");
    await expect.poll(() => argAt(doc.get(), "steps[0].slots")).toBe("8");
  });

  test("while the session is read-only, fields and picks say why and change nothing", async () => {
    const reason = "Editing moved to another tab";
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: projectFor(templateRecipe("SafeDiamondCut")), session: { readOnly: reason } });
    const admin = page.getByRole("textbox", { name: "Admin", exact: true });
    await expect.element(admin).toHaveAttribute("aria-disabled", "true");
    await expect.element(admin).toHaveAccessibleDescription(new RegExp(reason));
    const pick = page.getByRole("group", { name: "Safe quick picks" }).getByRole("button", { name: "This diamond" });
    await expect.element(pick).toHaveAttribute("aria-disabled", "true");
    await pick.click({ force: true });
    expect(argAt(doc.get(), "steps[0].safe")).toBeUndefined();
  });
});

describe("step inits (spec L467-L468)", () => {
  const catalog = kitchenCatalog();
  const steps = () => projectFor(stepsRecipe(catalog));
  const INIT_02 = "Payout initializes before ERC20; it must come after.";
  const order = () => {
    const init = doc.get().recipe.init;
    return init.kind === "steps" ? init.steps.map((s) => s.spec) : [];
  };

  test("INIT-02 inline, Reorder steps automatically, and one undo step back", async () => {
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: steps(), catalog });
    await expect.element(page.getByText(INIT_02)).toBeVisible();
    // The step's own fix, beside the header's: both are INIT-02's Reorder steps automatically (spec L328).
    await expect.element(page.getByRole("button", { name: "Reorder steps automatically" }).nth(1)).toBeVisible();
    await page.getByRole("button", { name: "Reorder steps automatically" }).first().click();
    await expect.poll(order).toEqual(["ERC20Init", "PayoutInit", "KitchenInit"]);
    expect(page.getByText(INIT_02).elements()).toHaveLength(0);
    history.undo();
    expect(order()).toEqual(["PayoutInit", "ERC20Init", "KitchenInit"]);
  });

  test("↑/↓ move a step, name it, and say why at either end; Alt+↓ moves too", async () => {
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: steps(), catalog });
    const up = page.getByRole("button", { name: "Move PayoutInit up" });
    await expect.element(up).toHaveAttribute("aria-disabled", "true");
    await expect.element(up).toHaveAccessibleDescription("PayoutInit is already the first step");
    await expect.element(page.getByRole("button", { name: "Move KitchenInit down" })).toHaveAccessibleDescription("KitchenInit is already the last step");
    await page.getByRole("button", { name: "Move ERC20Init up" }).click();
    await expect.poll(order).toEqual(["ERC20Init", "PayoutInit", "KitchenInit"]);
    expect(logged("Moved ERC20Init to step 1.")).toBe(true);

    (page.getByRole("button", { name: "Move PayoutInit up" }).element() as HTMLElement).focus();
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
    await expect.poll(order).toEqual(["ERC20Init", "KitchenInit", "PayoutInit"]);
  });

  test("the automatic ERC-165 step is appended, locked", async () => {
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: projectFor(templateRecipe("ERC20")) });
    await expect.element(page.getByRole("heading", { name: "Register ERC-165 interfaces (automatic)" })).toBeVisible();
    await expect.element(page.getByText("DiamondIntrospectionInit.initImmutable()")).toBeVisible();
    expect(page.getByRole("button", { name: /Move Register/ }).elements()).toHaveLength(0);
  });
});

describe("From link, Confirm address… and the Authority table", () => {
  const linked = () =>
    projectFor(
      {
        ...templateRecipe("SafeDiamondCut"),
        init: { kind: "steps", steps: [{ spec: "SafeDiamondCutInit", args: { admin: { $ref: "deployer" }, safe: SAFE, minThreshold: "2" } }] },
      },
      { provenance: { "steps[0].safe": "link" } },
    );

  test("From link until confirmed: the full address and its ENS name first, then one undo step", async () => {
    const chain = fakeChainService({ ens: { "ops.eth": SAFE }, code: { [SAFE]: SOME_CODE } });
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: linked(), session: { chainId: 11155111 }, chain });
    await expect.element(page.getByText("From link")).toBeVisible();
    await expect.element(page.getByText("The upgrade role goes to 0x71C7…976F, which came from a shared link.")).toBeVisible();
    await page.getByRole("button", { name: "Confirm address…" }).click();
    const panel = page.getByRole("region", { name: "Confirm address" });
    await expect.element(panel).toHaveFocus();
    await expect.element(panel.getByText(SAFE, { exact: true })).toBeVisible();
    await expect.element(panel.getByText("ENS name: ops.eth")).toBeVisible();
    await panel.getByRole("button", { name: "Confirm address" }).click();
    await expect.poll(() => doc.get().provenance["steps[0].safe"]).toBe("confirmed");
    expect(logged(`Confirmed Safe: ${SAFE}.`)).toBe(true);
    expect(page.getByText("From link").elements()).toHaveLength(0);
    await expect.element(page.getByRole("textbox", { name: "Safe", exact: true })).toHaveFocus();
    history.undo();
    expect(doc.get().provenance["steps[0].safe"]).toBe("link");
  });

  test("Esc or Cancel leaves it From link", async () => {
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: linked() });
    await page.getByRole("button", { name: "Confirm address…" }).click();
    await expect.element(page.getByRole("region", { name: "Confirm address" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    expect(page.getByRole("region", { name: "Confirm address" }).elements()).toHaveLength(0);
    expect(doc.get().provenance["steps[0].safe"]).toBe("link");
  });

  test("LINK-01's fix opens the panel on its field; Edit field focuses it", async () => {
    await renderWithStudio(<InspectorHost />, { project: linked() });
    await runCommand(commandRef("init.confirmAddress", { path: "steps[0].safe" }), "fix");
    await expect.element(page.getByRole("region", { name: "Confirm address" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await runCommand(commandRef("init.focusField", { path: "steps[0].minThreshold" }), "fix");
    await expect.element(page.getByRole("textbox", { name: "Min threshold", exact: true })).toHaveFocus();
    await runCommand(commandRef("init.open", { focus: "authority" }), "palette");
    await expect.element(page.getByRole("heading", { name: "Authority" })).toHaveFocus();
  });

  test("the Authority table: every role, full holders, how they get it, and the way to change who can upgrade", async () => {
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: vault() });
    const table = page.getByRole("table", { name: "Authority" });
    await expect.element(table).toBeVisible();
    const rowText = (role: string) => table.element().querySelector(`[data-authority-row="${role}"]`)?.textContent ?? "";
    expect(rowText("DEFAULT_ADMIN_ROLE")).toBe("DEFAULT_ADMIN_ROLEThis diamondGovernedVaultInit (the diamond itself)");
    expect(rowText("Executor")).toBe("ExecutoranyoneGovernedVaultInit (open execution)");
    expect(rowText("Guardian")).toBe("GuardiannoneEmergencyStop (no guardian at init)");
    await table.getByRole("button", { name: "Change who can upgrade…" }).click();
    expect(session.get().dialogs.map((d) => d.id)).toEqual(["choose-mechanism"]);
  });
});

describe("the chunk (spec L822)", () => {
  test("the registered view loads InitEditor lazily", async () => {
    await renderWithStudio(<InspectorHost />, { project: vault() });
    showView({ kind: "init", focus: "examples" });
    // INIT-05's Review fields lands on the first field still holding an example.
    await expect.element(page.getByRole("textbox", { name: "Name", exact: true })).toHaveFocus();
  });
});
