/** Clear data enables only once the counts arrive, and shows and logs its own failure (spec L637, L733). */
import { toChecksum, type Deployment } from "@lattice-studio/core";
import { makeRecipe } from "@lattice-studio/core/testing";
import { afterEach, expect, test, vi } from "vitest";
import { createProject, doc, openDialog, setCatalogStatus } from "@/contracts";
import { testPersistence } from "@/persist/testing";
import { DialogHost } from "@/ui";
import { bufferedServices, fixtureCatalog, onCleanup, renderWithStudio } from "../../../test/harness";

import type { FsDirectoryHandle, FsWindow } from "../fs-types";

const catalog = fixtureCatalog();

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as unknown as FsWindow).showDirectoryPicker;
});

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


test.each(["picker", "write", "close"] as const)("refuses clear when the current project changed after export during %s", async (phase) => {
  ready();
  const store = testPersistence({ quietMs: 60_000 });
  const created = await createProject(makeRecipe({}, catalog), "Vault");
  if (!created.ok) throw new Error(created.error);
  const screen = await renderWithStudio(<DialogHost />, { project: doc.get() });
  const edit = () => doc.apply("Edit during export", (project) => ({ project: { ...project, name: "New work" }, changed: true, summary: "Edit during export" }));
  let release: (directory: FsDirectoryHandle) => void = () => {};
  const picker = vi.fn(() => new Promise<FsDirectoryHandle>((resolve) => { release = resolve; }));
  (window as unknown as FsWindow).showDirectoryPicker = picker;
  openDialog("clear-data");
  await screen.getByRole("button", { name: "Export first" }).click();
  await vi.waitFor(() => expect(picker).toHaveBeenCalledOnce());
  await expect.element(screen.getByRole("button", { name: "Delete everything" })).toHaveAttribute("aria-disabled", "true");
  if (phase === "picker") edit();
  release({ getFileHandle: async (name) => ({ name, createWritable: async () => ({
    write: async () => { if (phase === "write") edit(); },
    close: async () => { if (phase === "close") edit(); },
  }) }) });
  const remove = screen.getByRole("button", { name: "Delete everything" });
  await expect.element(remove).not.toHaveAttribute("aria-disabled");
  expect(await store.listProjects()).toHaveLength(1);
  await remove.click();
  await expect.element(screen.getByText("The current project changed after export. Export again before deleting.")).toBeVisible();
  expect(await store.listProjects()).toHaveLength(1);
  expect(doc.get().name).toBe("New work");
});


test.each([false, true])("the final service clear refuses a document changed after the click, exported: %s", async (exported) => {
  ready();
  const store = testPersistence({ quietMs: 60_000 });
  const made = await createProject(makeRecipe({}, catalog), "Vault");
  if (!made.ok) throw new Error(made.error);
  const screen = await renderWithStudio(<DialogHost />, { project: doc.get() });
  (window as unknown as FsWindow).showDirectoryPicker = async () => ({ getFileHandle: async (name) => ({ name, createWritable: async () => ({ write: async () => {}, close: async () => {} }) }) });
  openDialog("clear-data");
  if (exported) {
    await screen.getByRole("button", { name: "Export first" }).click();
    await vi.waitFor(() => expect(bufferedServices().log.at(-1)?.text).toBe("Exported 1 file."));
  }
  const clear = store.clearData.bind(store);
  vi.spyOn(store, "clearData").mockImplementation(async (expected) => {
    await Promise.resolve();
    doc.apply("Late edit", (project) => ({ project: { ...project, name: "After click" }, changed: true, summary: "Late edit" }));
    await clear(expected);
  });
  const remove = screen.getByRole("button", { name: "Delete everything" });
  await expect.element(remove).not.toHaveAttribute("aria-disabled");
  await remove.click();
  await expect.element(screen.getByRole("dialog").getByRole("alert")).toHaveTextContent("The current project changed after export. Export again before deleting.");
  expect(await store.listProjects()).toHaveLength(1);
  expect(doc.get().name).toBe("After click");
});

test.each(["new", "file"] as const)("successful deliberate clear can continue with %s", async (next) => {
  ready();
  const store = testPersistence({ quietMs: 60_000 });
  const made = await createProject(makeRecipe({}, catalog), "Vault");
  if (!made.ok) throw new Error(made.error);
  const screen = await renderWithStudio(<DialogHost />, { project: doc.get() });
  let text = "";
  (window as unknown as FsWindow).showDirectoryPicker = async () => ({ getFileHandle: async (name) => ({ name, createWritable: async () => ({ write: async (value) => { text = value; }, close: async () => {} }) }) });
  openDialog("clear-data");
  if (next === "file") {
    await screen.getByRole("button", { name: "Export first" }).click();
    await vi.waitFor(() => expect(text).not.toBe(""));
  }
  const remove = screen.getByRole("button", { name: "Delete everything" });
  await expect.element(remove).not.toHaveAttribute("aria-disabled");
  await remove.click();
  await vi.waitFor(() => expect(bufferedServices().log.at(-1)?.text).toBe("Cleared Studio's data in this browser. Start a new project or open a project file to continue."));
  expect(await store.listProjects()).toEqual([]);
  const { startNewProject, openImportedFile } = await import("../actions");
  if (next === "new") expect((await startNewProject()).ok).toBe(true);
  else await openImportedFile("vault.lattice.json", text);
  expect(doc.get().id).not.toBe(made.value.id);
  expect(doc.get().name).toBe(next === "new" ? "Untitled" : "Vault");
});

test("a cancelled export leaves the clear dialog usable without clearing", async () => {
  ready();
  const store = testPersistence();
  await createProject(makeRecipe({}, catalog), "Vault");
  const screen = await renderWithStudio(<DialogHost />, { project: doc.get() });
  (window as unknown as FsWindow).showDirectoryPicker = async () => { throw new DOMException("Cancelled", "AbortError"); };
  openDialog("clear-data");
  await screen.getByRole("button", { name: "Export first" }).click();
  await expect.element(screen.getByRole("button", { name: "Delete everything" })).not.toHaveAttribute("aria-disabled");
  expect(await store.listProjects()).toHaveLength(1);
  expect(bufferedServices().log.some((line) => line.text.startsWith("Exported"))).toBe(false);
});

test("export read failure stays inline and retains the clear dialog", async () => {
  ready();
  const store = testPersistence();
  await createProject(makeRecipe({}, catalog), "Vault");
  const screen = await renderWithStudio(<DialogHost />, { project: doc.get() });
  openDialog("clear-data");
  await expect.element(screen.getByRole("button", { name: "Delete everything" })).not.toHaveAttribute("aria-disabled");
  await store.close();
  await screen.getByRole("button", { name: "Export first" }).click();
  await expect.element(screen.getByRole("dialog").getByRole("alert")).toHaveTextContent("Couldn't export all projects. Storage is closed. Save a copy to recover the current project.");
  await expect.element(screen.getByRole("button", { name: "Delete everything" })).not.toHaveAttribute("aria-disabled");
});
