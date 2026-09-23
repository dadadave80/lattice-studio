import type { Project, Recipe } from "@lattice-studio/core";
import { planMechanismChange } from "@lattice-studio/core";
import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { commandRef, commandState, doc, history, openDialog, runCommand, session } from "@/contracts";
import { DialogHost } from "@/ui";
import { bufferedServices, fakeChainService, fixtureCatalog, renderWithStudio } from "../../../test/harness";
import { projectFor, SAFE, templateRecipe } from "./test-support";

const TITLE = "Choose an upgrade mechanism";

function logged(text: string): boolean {
  return bufferedServices().log.some((line) => line.text === text);
}

async function open(project: Project, options: Parameters<typeof renderWithStudio>[1] = {}, preset?: "safe" | "governance") {
  await renderWithStudio(<DialogHost />, { project, ...options });
  openDialog("choose-mechanism", preset ? { preset } : {});
  const dialog = page.getByRole("dialog", { name: TITLE });
  await expect.element(dialog).toBeVisible();
  return dialog;
}

/** An Admin-role diamond: ERC20 after Flow 17 chose Admin role. */
function adminRecipe(): Recipe {
  const change = planMechanismChange(templateRecipe("ERC20"), fixtureCatalog(), "admin", {});
  if (!change.ok) throw new Error(change.error);
  return change.value.next;
}

describe("Choose an upgrade mechanism (Flow 17, IR L175)", () => {
  test("five options, each saying who can upgrade and how fast; focus starts on the current one", async () => {
    const dialog = await open(projectFor(templateRecipe("SafeDiamondCut")));
    for (const label of ["Admin role", "Safe", "Safe with delay", "Governance", "Immutable"]) {
      await expect.element(dialog.getByRole("radio", { name: label, exact: true })).toBeVisible();
    }
    const safe = dialog.getByRole("radio", { name: "Safe", exact: true });
    await expect.element(safe).toHaveAttribute("aria-checked", "true");
    await expect.element(safe).toHaveFocus();
    await expect.element(safe).toHaveAccessibleDescription("SafeDiamondCut: only the pinned Safe cuts, at its threshold.");
    await expect.element(dialog.getByRole("radio", { name: "Admin role" })).toHaveAccessibleDescription(
      "AccessControlDiamondCut: holders of DEFAULT_ADMIN_ROLE cut at once.",
    );
    // Governance is disabled with the spec's reason (spec L648), written where everyone can read it.
    await expect.element(dialog.getByRole("radio", { name: "Governance" })).toHaveAttribute("aria-disabled", "true");
    const written = dialog.element().querySelector("[data-reason]");
    expect(written?.textContent).toBe("Governance needs GovernedVault's Governor, Votes and TimelockController; Lattice has no standalone Governor init.");
  });

  test("asks only for what the choice needs", async () => {
    const dialog = await open(projectFor(templateRecipe("ERC20")), {}, "safe");
    await expect.element(dialog.getByRole("textbox", { name: "Safe address" })).toBeVisible();
    await expect.element(dialog.getByRole("textbox", { name: "Minimum threshold" })).toBeVisible();
    expect(dialog.getByRole("textbox", { name: "Delay" }).elements()).toHaveLength(0);
    await dialog.getByRole("radio", { name: "Safe with delay" }).click();
    await expect.element(dialog.getByRole("textbox", { name: "Delay" })).toBeVisible();
    await dialog.getByRole("radio", { name: "Immutable" }).click();
    expect(dialog.getByRole("textbox").elements()).toHaveLength(0);
    await expect.element(dialog.getByRole("button", { name: "Keep immutable" })).toBeVisible();
  });

  test("previews every change, applies as one undo step, and says so in the console", async () => {
    const before = templateRecipe("ERC20");
    const dialog = await open(projectFor(before), {}, "safe");
    const use = dialog.getByRole("button", { name: "Use SafeDiamondCut" });
    await expect.element(use).toHaveAttribute("aria-disabled", "true");
    await expect.element(use).toHaveAccessibleDescription("Enter the Safe's address.");
    await expect.element(dialog.getByRole("region", { name: "What changes" }).getByText("Enter the Safe's address.")).toBeVisible();

    await dialog.getByRole("textbox", { name: "Safe address" }).fill(SAFE.toLowerCase());
    await dialog.getByRole("textbox", { name: "Minimum threshold" }).fill("2");
    const preview = dialog.getByRole("region", { name: "What changes" });
    for (const line of [
      "Place SafeDiamondCut",
      "Place EmergencyStop",
      "Place AccessControl",
      "Init: SafeDiamondCutInit(admin, safe, minThreshold) replaces the automatic ERC-165 step, since it sets up AccessControl, EmergencyStop and the flags itself",
      "Upgrade → Safe 0x71C7…976F, at least 2 signatures",
      "Clear Keep immutable",
    ]) {
      await expect.element(preview.getByText(line, { exact: true })).toBeVisible();
    }
    // Nothing changed yet.
    expect(doc.get().recipe.facets).toEqual(before.facets);

    await use.click();
    await expect.poll(() => session.get().dialogs.length).toBe(0);
    const after = doc.get();
    expect(after.recipe.facets).toEqual(expect.arrayContaining(["SafeDiamondCut", "EmergencyStop", "AccessControl"]));
    expect(after.recipe.immutable).toBeUndefined();
    const step = after.recipe.init.kind === "steps" ? after.recipe.init.steps.find((s) => s.spec === "SafeDiamondCutInit") : undefined;
    expect(step?.args.safe).toBe(SAFE);
    for (const facet of ["SafeDiamondCut", "EmergencyStop", "AccessControl"]) expect(after.layout[facet]).toBeDefined();
    expect(logged("Upgrade mechanism: SafeDiamondCut · Safe 0x71C7…976F.")).toBe(true);

    expect(history.undo()).toBe("Use SafeDiamondCut");
    expect(doc.get().recipe.facets).toEqual(before.facets);
    expect(doc.get().recipe.immutable).toBe(true);
    expect(doc.get().recipe.init).toEqual(before.init);
    expect(history.canUndo).toBe(false);
  });

  test("Admin role's Use a Safe… keeps the mechanism and hands DEFAULT_ADMIN_ROLE to the Safe (spec L650)", async () => {
    const recipe = adminRecipe();
    const dialog = await open(projectFor(recipe));
    await expect.element(dialog.getByRole("radio", { name: "Admin role" })).toHaveFocus();
    await dialog.getByRole("checkbox", { name: /Use a Safe/ }).click();
    await dialog.getByRole("textbox", { name: "Safe address" }).fill(SAFE);
    const preview = dialog.getByRole("region", { name: "What changes" });
    await expect.element(preview.getByText("Init: AccessControlInit(admin) → Safe 0x71C7…976F", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Use AccessControlDiamondCut" }).click();
    await expect.poll(() => session.get().dialogs.length).toBe(0);
    expect(doc.get().recipe.facets).toEqual(recipe.facets);
    const init = doc.get().recipe.init;
    expect(init.kind === "steps" ? init.steps.find((s) => s.spec === "AccessControlInit")?.args.admin : undefined).toBe(SAFE);
    expect(logged("Upgrade mechanism: AccessControlDiamondCut · Safe 0x71C7…976F.")).toBe(true);
  });

  test("AUTH-01's Use a Safe… on an Admin-role diamond offers keeping the mechanism straight away", async () => {
    const dialog = await open(projectFor(adminRecipe()), {}, "safe");
    await expect.element(dialog.getByRole("radio", { name: "Admin role" })).toHaveAttribute("aria-checked", "true");
    await expect.element(dialog.getByRole("checkbox", { name: /Use a Safe/ })).toHaveAttribute("aria-checked", "true");
    await expect.element(dialog.getByRole("textbox", { name: "Safe address" })).toBeVisible();
    await expect.element(dialog.getByRole("button", { name: "Use AccessControlDiamondCut" })).toBeVisible();
  });

  test("a Safe given as a reference is named in the console line", async () => {
    const dialog = await open(projectFor(templateRecipe("ERC20")), {}, "safe");
    await dialog.getByRole("button", { name: "This diamond" }).click();
    await dialog.getByRole("textbox", { name: "Minimum threshold" }).fill("1");
    await dialog.getByRole("button", { name: "Use SafeDiamondCut" }).click();
    await expect.poll(() => session.get().dialogs.length).toBe(0);
    expect(logged("Upgrade mechanism: SafeDiamondCut · Safe at this diamond.")).toBe(true);
  });

  test("a bundle that sets up its own mechanism decides it, and the dialog offers no other choice", async () => {
    const dialog = await open(projectFor(templateRecipe("GovernedVault")));
    await expect.element(dialog).toHaveAccessibleDescription("GovernedVaultInit sets up the upgrade mechanism itself, so the bundle decides it.");
    await expect.element(dialog.getByRole("radio", { name: "Governance" })).toHaveAttribute("aria-checked", "true");
    await expect.element(dialog.getByRole("radio", { name: "Safe", exact: true })).toHaveAttribute("aria-disabled", "true");
    expect(dialog.getByRole("button", { name: /^Use / }).elements()).toHaveLength(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect.poll(() => session.get().dialogs.length).toBe(0);
  });

  test("a Safe address with no Safe on the selected chain says so before applying", async () => {
    const chain = fakeChainService();
    const dialog = await open(projectFor(templateRecipe("ERC20")), { chain, session: { chainId: 11155111 } }, "safe");
    await dialog.getByRole("textbox", { name: "Safe address" }).fill(SAFE);
    await expect.element(dialog.getByRole("textbox", { name: "Safe address" })).toHaveAccessibleDescription(
      /No Safe at this address on Sepolia yet\. Deploy the Safe first\./,
    );
  });

  test("Cancel changes nothing; while read-only the primary says why", async () => {
    const reason = "Editing moved to another tab";
    const project = projectFor(templateRecipe("SafeDiamondCut"));
    const dialog = await open(project, { session: { readOnly: reason } });
    const primary = dialog.getByRole("button", { name: "Use SafeDiamondCut" });
    await expect.element(primary).toHaveAttribute("aria-disabled", "true");
    await expect.element(primary).toHaveAccessibleDescription(reason);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect.poll(() => session.get().dialogs.length).toBe(0);
    expect(doc.get().recipe).toEqual(project.recipe);
  });
});

describe("authority.chooseMechanism", () => {
  test("titles its presets, says why governance can't be chosen, and is off while read-only", async () => {
    await renderWithStudio(<DialogHost />, { project: projectFor(templateRecipe("ERC20")) });
    expect(commandState(commandRef("authority.chooseMechanism")).title).toBe("Choose an upgrade mechanism…");
    expect(commandState(commandRef("authority.chooseMechanism", { preset: "safe" })).title).toBe("Use a Safe…");
    expect(commandState(commandRef("authority.chooseMechanism", { preset: "governance" }))).toMatchObject({
      ok: false,
      title: "Use governance…",
      reason: "Governance needs GovernedVault's Governor, Votes and TimelockController; Lattice has no standalone Governor init.",
    });
    await runCommand(commandRef("authority.chooseMechanism", { preset: "safe" }), "fix");
    await expect.element(page.getByRole("radio", { name: "Safe", exact: true })).toHaveAttribute("aria-checked", "true");
    session.set({ readOnly: "Editing moved to another tab", dialogs: [] });
    expect(commandState(commandRef("authority.chooseMechanism"))).toMatchObject({ ok: false, reason: "Editing moved to another tab" });
  });
});
