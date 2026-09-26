import type { Recipe } from "@lattice-studio/core";
import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { commandRef, commandState, doc, history, runCommand, session } from "@/contracts";
import { DialogHost } from "@/ui/overlays/DialogHost";
import { bufferedServices, fixtureCatalog, renderWithStudio } from "../../test/harness";
import { ELSEWHERE } from "./copy";
import { loadMigrationSides } from "./migrate";
import { projectFor, loadWithManifest, resetFlows, template } from "./test-support";

afterEach(() => {
  resetFlows();
});

const MIGRATE = commandRef("catalog.migrate");

/** GovernedVault with the three facets fixture-next changes (fixtures/README.md). */
function recipe(): Recipe {
  const base = template("GovernedVault");
  const extra = ["EmergencyStop", "Governor", "ERC20"].filter((f) => !base.facets.includes(f));
  return { ...base, facets: [...base.facets, ...extra] };
}

/** A project on `fixture`, in a build whose default catalog is `fixture-next`: "an old project" (IR L178). */
async function oldProject() {
  const project = projectFor(recipe(), { name: "Vault" });
  await renderWithStudio(<DialogHost />, { project });
  loadWithManifest(fixtureCatalog("fixture"), "fixture-next");
  return project;
}

describe("Migrate (spec L290): fixture to fixture-next", () => {
  test("the review lists the selectors added and removed per facet and the changed code, summary first", async () => {
    await oldProject();
    expect(commandState(MIGRATE)).toMatchObject({ ok: true, title: "Migrate to fixture-next…" });
    await runCommand(MIGRATE, "palette");
    const dialog = page.getByRole("dialog", { name: "Migrate" });
    const summary = dialog.getByText("Catalog fixture to fixture-next: 1 selector added, 1 selector removed, new code for 3 contracts.");
    await expect.element(summary).toBeVisible();
    await expect.element(summary).toHaveFocus();
    const emergency = fixtureCatalog("fixture-next").facets.find((f) => f.name === "EmergencyStop");
    const added = emergency?.selectors.find((s) => s.signature === "guardianCount()");
    const governor = fixtureCatalog("fixture").facets.find((f) => f.name === "Governor");
    const removed = governor?.selectors.find((s) => s.signature === "version()");
    await expect.element(dialog.getByText(`Added guardianCount() ${added?.hex}`)).toBeVisible();
    await expect.element(dialog.getByText(`Removed version() ${removed?.hex}`)).toBeVisible();
    await expect.element(dialog.getByRole("heading", { name: "ERC20 facet" })).toBeVisible();
    expect(dialog.getByText("New code:", { exact: false }).elements()).toHaveLength(3);
    // Not read-only: the way out is Cancel.
    await expect.element(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
  });

  test("Migrate to fixture-next pins the project there and starts its history over", async () => {
    await oldProject();
    await runCommand(commandRef("project.rename", { name: "Vault 2" }), "api");
    expect(history.canUndo).toBe(true);
    await runCommand(MIGRATE, "palette");
    await page.getByRole("button", { name: "Migrate to fixture-next", exact: true }).click();
    await expect.element(page.getByRole("dialog", { name: "Migrate" })).not.toBeInTheDocument();
    const next = fixtureCatalog("fixture-next");
    expect(doc.get().recipe.catalog).toEqual({ tag: "fixture-next", hash: next.hash });
    expect(doc.get().name).toBe("Vault 2");
    expect([...doc.get().recipe.facets].sort()).toEqual([...recipe().facets].sort());
    expect(history.canUndo).toBe(false);
    expect(bufferedServices().log.some((l) => l.text === "Migrated to catalog fixture-next. Undo history starts here.")).toBe(true);
  });

  test("Esc leaves the project as it was", async () => {
    const project = await oldProject();
    await runCommand(MIGRATE, "palette");
    await expect.element(page.getByRole("dialog", { name: "Migrate" }).getByText("new code for 3 contracts", { exact: false })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog", { name: "Migrate" })).not.toBeInTheDocument();
    expect(doc.get().recipe.catalog).toEqual(project.recipe.catalog);
  });

  test("a project on the build's catalog has nowhere to migrate", async () => {
    await renderWithStudio(<DialogHost />, { project: projectFor(recipe()) });
    loadWithManifest(fixtureCatalog("fixture"));
    expect(commandState(MIGRATE)).toMatchObject({ ok: false, reason: "This project already uses catalog fixture" });
  });

  test("while another tab edits, Migrate waits for Take over editing", async () => {
    await oldProject();
    session.set({ readOnly: ELSEWHERE });
    await runCommand(MIGRATE, "palette");
    const migrate = page.getByRole("button", { name: "Migrate to fixture-next", exact: true });
    await expect.element(migrate).toHaveAttribute("aria-disabled", "true");
    await expect.element(migrate).toHaveAccessibleDescription(ELSEWHERE);
  });

  test("the review loads the old catalog when it's bundled, and none when it isn't", async () => {
    await oldProject();
    const bundled = await loadMigrationSides(doc.get(), "fixture-next");
    expect(bundled.ok && bundled.value.from?.hash).toBe(fixtureCatalog("fixture").hash);
    expect(bundled.ok && bundled.value.to.hash).toBe(fixtureCatalog("fixture-next").hash);
    const retired = { ...doc.get(), recipe: { ...doc.get().recipe, catalog: { tag: "v0.3.0", hash: `0x${"ab".repeat(32)}` as const } } };
    const unbundled = await loadMigrationSides(retired, undefined);
    expect(unbundled.ok && unbundled.value.from).toBeNull();
    expect(unbundled.ok && unbundled.value.to.lattice.tag).toBe("fixture-next");
  });
});
