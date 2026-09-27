/** Recently deleted's "deleted …" tooltip gives the absolute time, the same way the Recent row's does. */
import { makeRecipe } from "@lattice-studio/core/testing";
import { expect, test } from "vitest";
import { createProject, openDialog, runCommand, setCatalogStatus } from "@/contracts";
import { testPersistence } from "@/persist/testing";
import { DialogHost } from "@/ui";
import { fixtureCatalog, onCleanup, renderWithStudio } from "../../../test/harness";

const catalog = fixtureCatalog();

function ready(): void {
  setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
  onCleanup(() => setCatalogStatus({ status: "loading" }));
}

test("the deleted time's tooltip gives the absolute time (spec L508/L687)", async () => {
  ready();
  testPersistence();
  const created = await createProject(makeRecipe({}, catalog), "TrashTooltipVault");
  if (!created.ok) throw new Error(created.error);
  const deleted = await runCommand({ id: "project.delete", args: { id: created.value.id } }, "api");
  if (!deleted.ok) throw new Error(deleted.reason);

  const screen = await renderWithStudio(<DialogHost />);
  openDialog("projects", { tab: "deleted" });

  const row = screen.getByText(/^deleted /);
  await row.hover();
  const tooltip = () => document.querySelector<HTMLElement>("[data-tooltip]");
  await expect.poll(tooltip, { timeout: 2000 }).not.toBeNull();
  expect(tooltip()?.textContent).not.toBe("");
  expect(tooltip()?.textContent).not.toContain("deleted");
});
