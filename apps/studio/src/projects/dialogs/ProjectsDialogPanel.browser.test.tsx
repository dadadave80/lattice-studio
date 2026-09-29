/** Each row's action buttons carry the project's name (spec's accessible-name rules); focus never falls to
 * the body once a row that held it is gone. */
import { makeRecipe } from "@lattice-studio/core/testing";
import { expect, test } from "vitest";
import { createProject, openDialog, setCatalogStatus } from "@/contracts";
import { testPersistence } from "@/persist/testing";
import { DialogHost } from "@/ui";
import { fixtureCatalog, onCleanup, renderWithStudio } from "../../../test/harness";

const catalog = fixtureCatalog();

function ready(): void {
  setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
  onCleanup(() => setCatalogStatus({ status: "loading" }));
}

test("each row's buttons have a per-row accessible name", async () => {
  ready();
  testPersistence();
  const vault = await createProject(makeRecipe({}, catalog), "Vault");
  if (!vault.ok) throw new Error(vault.error);
  const token = await createProject(makeRecipe({}, catalog), "Token");
  if (!token.ok) throw new Error(token.error);

  const screen = await renderWithStudio(<DialogHost />);
  openDialog("projects", { tab: "recent" });

  await expect.element(screen.getByRole("button", { name: "Delete Vault" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Delete Token" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Rename Vault" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Duplicate Vault" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Export Vault" })).toBeVisible();
});

test("deleting a row moves focus to the list, not the body", async () => {
  ready();
  testPersistence();
  const vault = await createProject(makeRecipe({}, catalog), "Vault");
  if (!vault.ok) throw new Error(vault.error);

  const screen = await renderWithStudio(<DialogHost />);
  openDialog("projects", { tab: "recent" });

  const deleteButton = screen.getByRole("button", { name: "Delete Vault" });
  await expect.element(deleteButton).toBeVisible();
  await deleteButton.click();

  // The harness's own Untitled document autosaves about a second after mount, so the list may or may not be
  // empty by now: wait for Vault's row to go, not for "No projects yet.".
  await expect.element(deleteButton).not.toBeInTheDocument();
  expect(document.activeElement?.tagName).not.toBe("BODY");
});
