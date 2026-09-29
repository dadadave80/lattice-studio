/** Clear data enables only once the counts arrive, and shows and logs its own failure (spec L637, L733). */
import { toChecksum, type Deployment } from "@lattice-studio/core";
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

function address(n: number): `0x${string}` {
  return toChecksum(`0x${n.toString(16).padStart(40, "a")}`);
}

function deployment(projectId: string, n: number): Deployment {
  return {
    projectId,
    chainId: 11155111,
    address: address(n),
    path: "factory",
    deployer: address(999),
    salt: `0x${"11".repeat(32)}`,
    status: "confirmed",
    recipeHash: `0x${"22".repeat(32)}`,
    catalogHash: `0x${"33".repeat(32)}`,
    at: "2026-09-23T12:00:00.000Z",
    verification: "match",
    revision: 1,
  };
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

test("counts a confirmed deployment record: \"including the only record of 1 deployed address\" (spec L502, L637)", async () => {
  ready();
  const store = testPersistence();
  const created = await createProject(makeRecipe({}, catalog), "Vault");
  if (!created.ok) throw new Error(created.error);
  await store.deployments.putDeployment(deployment(created.value.id, 1));

  const screen = await renderWithStudio(<DialogHost />);
  openDialog("clear-data");

  await expect
    .element(screen.getByText("This deletes 1 project, including the only record of 1 deployed address.", { exact: false }))
    .toBeVisible();
});

test("Export first has focus when the dialog opens (IR)", async () => {
  ready();
  testPersistence();
  const created = await createProject(makeRecipe({}, catalog), "Vault");
  if (!created.ok) throw new Error(created.error);

  const screen = await renderWithStudio(<DialogHost />);
  openDialog("clear-data");

  await expect.element(screen.getByRole("button", { name: "Export first" })).toHaveFocus();
});
