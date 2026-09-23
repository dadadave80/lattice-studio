/** Delete for good counts what it would lose (spec L502): "This deletes the only record of 2 deployed addresses." */
import { toChecksum, type Deployment } from "@lattice-studio/core";
import { makeRecipe } from "@lattice-studio/core/testing";
import { expect, test } from "vitest";
import { createProject, openDialog, runCommand, setCatalogStatus } from "@/contracts";
import { testPersistence } from "@/persist/testing";
import { DialogHost } from "@/ui";
import { bufferedServices, fixtureCatalog, onCleanup, renderWithStudio } from "../../../test/harness";

const catalog = fixtureCatalog();

function address(n: number): `0x${string}` {
  return toChecksum(`0x${n.toString(16).padStart(40, "a")}`);
}

function deployment(projectId: string, n: number, extra: Partial<Deployment> = {}): Deployment {
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
    ...extra,
  };
}

test("counts the deployed addresses it would lose, with Export first beside Delete for good", async () => {
  setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
  onCleanup(() => setCatalogStatus({ status: "loading" }));
  const store = testPersistence();
  const opened = await createProject(makeRecipe({}, catalog), "Vault");
  if (!opened.ok) throw new Error(opened.error);
  const id = opened.value.id;
  await store.deployments.putDeployment(deployment(id, 1));
  await store.deployments.putDeployment(deployment(id, 2));
  const deleted = await runCommand({ id: "project.delete", args: { id } }, "api");
  if (!deleted.ok) throw new Error(deleted.reason);

  const screen = await renderWithStudio(<DialogHost />);
  openDialog("delete-for-good", { projectId: id });

  await expect.element(screen.getByText("This deletes the only record of 2 deployed addresses.", { exact: false })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Export first" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Delete for good" })).toBeVisible();
});

test("nothing deployed: no address count, but still irreversible", async () => {
  setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
  onCleanup(() => setCatalogStatus({ status: "loading" }));
  const store = testPersistence();
  const opened = await createProject(makeRecipe({}, catalog), "Empty");
  if (!opened.ok) throw new Error(opened.error);
  const id = opened.value.id;
  const deleted = await runCommand({ id: "project.delete", args: { id } }, "api");
  if (!deleted.ok) throw new Error(deleted.reason);
  void store;

  const screen = await renderWithStudio(<DialogHost />);
  openDialog("delete-for-good", { projectId: id });

  await expect.element(screen.getByText("This can't be undone.", { exact: false })).toBeVisible();
});

test("Delete for good stays disabled until the counts arrive", async () => {
  setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
  onCleanup(() => setCatalogStatus({ status: "loading" }));
  testPersistence();
  const opened = await createProject(makeRecipe({}, catalog), "Vault");
  if (!opened.ok) throw new Error(opened.error);
  const id = opened.value.id;
  const deleted = await runCommand({ id: "project.delete", args: { id } }, "api");
  if (!deleted.ok) throw new Error(deleted.reason);

  const screen = await renderWithStudio(<DialogHost />);
  openDialog("delete-for-good", { projectId: id });
  const button = screen.getByRole("button", { name: "Delete for good" });

  await expect.element(button).toHaveAttribute("aria-disabled", "true");
  await expect.element(button).not.toHaveAttribute("aria-disabled");
});

test("says why and logs it when the delete itself fails (spec L733: no silent no-op)", async () => {
  setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
  onCleanup(() => setCatalogStatus({ status: "loading" }));
  const store = testPersistence();
  const opened = await createProject(makeRecipe({}, catalog), "Vault");
  if (!opened.ok) throw new Error(opened.error);
  const id = opened.value.id;
  const deleted = await runCommand({ id: "project.delete", args: { id } }, "api");
  if (!deleted.ok) throw new Error(deleted.reason);

  const screen = await renderWithStudio(<DialogHost />);
  openDialog("delete-for-good", { projectId: id });
  const button = screen.getByRole("button", { name: "Delete for good" });
  await expect.element(button).not.toHaveAttribute("aria-disabled");

  // Another tab (or the 30-day expiry) already finished deleting it for good.
  const gone = await store.deleteForGood(id);
  if (!gone.ok) throw new Error(gone.error);

  await button.click();
  await expect.element(screen.getByText("This project isn't in Recently deleted.", { exact: false })).toBeVisible();
  const line = bufferedServices().log.at(-1);
  expect(line?.tag).toBe("Error");
  expect(line?.text).toContain("This project isn't in Recently deleted.");
});
