/** Clear data enables only once the counts arrive, and shows and logs its own failure (spec L637, L733). */
import { makeRecipe } from "@lattice-studio/core/testing";
import { expect, test } from "vitest";
import { createProject, openDialog, setCatalogStatus } from "@/contracts";
import { testPersistence } from "@/persist/testing";
import { DialogHost } from "@/ui";
import { bufferedServices, fixtureCatalog, onCleanup, renderWithStudio } from "../../../test/harness";

const catalog = fixtureCatalog();

function ready(): void {
  setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
  onCleanup(() => setCatalogStatus({ status: "loading" }));
}

test("Delete everything becomes usable once the counts arrive", async () => {
  ready();
  testPersistence();
  const created = await createProject(makeRecipe({}, catalog), "Vault");
  if (!created.ok) throw new Error(created.error);

  const screen = await renderWithStudio(<DialogHost />);
  openDialog("clear-data");
  const button = screen.getByRole("button", { name: "Delete everything" });

  // `clearDataCounts()` is a real (fast) IndexedDB read: this only proves it settles, not that it starts
  // disabled — DeleteForGoodDialogPanel's slower two-read effect covers catching the disabled window itself.
  await expect.element(button).not.toHaveAttribute("aria-disabled");
});

test("says why and logs it when clearing fails", async () => {
  ready();
  const store = testPersistence();
  const created = await createProject(makeRecipe({}, catalog), "Vault");
  if (!created.ok) throw new Error(created.error);

  const screen = await renderWithStudio(<DialogHost />);
  openDialog("clear-data");
  const button = screen.getByRole("button", { name: "Delete everything" });
  await expect.element(button).not.toHaveAttribute("aria-disabled");

  // Storage closed under us (a newer Studio version upgraded the database in another tab).
  await store.close();

  await button.click();
  await expect.element(screen.getByText("Couldn't clear Studio's data.", { exact: false })).toBeVisible();
  const line = bufferedServices().log.at(-1);
  expect(line?.tag).toBe("Error");
  expect(line?.text).toContain("Couldn't clear Studio's data.");
});
