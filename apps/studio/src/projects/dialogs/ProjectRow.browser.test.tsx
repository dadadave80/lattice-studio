/**
 * A Recent row's name button stays a real, reachable target even at the Projects dialog's 640 px "wide"
 * width, where the status chip, "saved …" text and four action buttons alone come close to the row's content
 * width (CCR, `apps/studio/e2e/q1d/flow-10-save-open.spec.ts:400-411`): the name used to shrink to 0 px.
 */
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { expect, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { createProject, doc, openDialog, setCatalogStatus } from "@/contracts";
import { fakeDoc, testPersistence } from "@/persist/testing";
import { DialogHost } from "@/ui";
import { fixtureCatalog, onCleanup, renderWithStudio } from "../../../test/harness";

import { ProjectRow } from "./ProjectRow";

const catalog = fixtureCatalog();

function ready(): void {
  setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
  onCleanup(() => setCatalogStatus({ status: "loading" }));
}

test("a Recent row's name button is a real target (not 0 px) at the dialog's wide width", async () => {
  ready();
  testPersistence();
  const created = await createProject(makeRecipe({}, catalog), "A project with a fairly long name");
  if (!created.ok) throw new Error(created.error);

  const screen = await renderWithStudio(<DialogHost />);
  openDialog("projects", { tab: "recent" });

  const nameButton = screen.getByRole("button", { name: "A project with a fairly long name" });
  await expect.element(nameButton).toBeVisible();
  const rect = nameButton.element().getBoundingClientRect();
  // A real, 2.5.8-sized target (spec's 24 × 24 CSS px minimum), not merely non-zero.
  expect(rect.width).toBeGreaterThanOrEqual(24);
  expect(rect.height).toBeGreaterThanOrEqual(24);
});

test("renaming the open project's own row updates it live, without closing the dialog", async () => {
  ready();
  testPersistence();
  const created = await createProject(makeRecipe({}, catalog), "SelfRenameVault");
  if (!created.ok) throw new Error(created.error);

  const screen = await renderWithStudio(<DialogHost />);
  openDialog("projects", { tab: "recent" });

  await screen.getByRole("button", { name: "Rename SelfRenameVault" }).click();
  const field = screen.getByRole("textbox", { name: "Project name" });
  await field.fill("SelfRenameVault Renamed");
  await userEvent.keyboard("{Enter}");

  await expect.element(screen.getByRole("button", { name: "SelfRenameVault Renamed" })).toBeVisible();
});

test("the saved time's tooltip gives the absolute time (spec L508/L687)", async () => {
  ready();
  testPersistence();
  const created = await createProject(makeRecipe({}, catalog), "TooltipVault");
  if (!created.ok) throw new Error(created.error);

  const screen = await renderWithStudio(<DialogHost />);
  openDialog("projects", { tab: "recent" });

  const saved = screen.getByText(/^saved /);
  await saved.hover();
  const tooltip = () => document.querySelector<HTMLElement>("[data-tooltip]");
  await expect.poll(tooltip, { timeout: 2000 }).not.toBeNull();
  // `formatTime`'s title is the absolute time, always distinct from the relative "saved just now" text.
  expect(tooltip()?.textContent).not.toBe("");
  expect(tooltip()?.textContent).not.toContain("saved");
});


test("a refused remote rename reports the owner's exact reason accessibly", async () => {
  ready();
  const store = testPersistence();
  const created = await createProject(makeRecipe({}, catalog), "Owner project");
  if (!created.ok) throw new Error(created.error);
  const second = testPersistence({ dbName: store.dbName, doc: fakeDoc(makeProject()), provide: true, page: null });
  const own = await second.projects.createProject(makeRecipe({}, catalog), "Other project");
  if (!own.ok) throw new Error(own.error);
  const screen = await renderWithStudio(<DialogHost />, { project: doc.get() });
  openDialog("projects", { tab: "recent" });
  await screen.getByRole("button", { name: "Rename Owner project" }).click();
  await screen.getByRole("textbox", { name: "Project name" }).fill("Remote rename");
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByRole("dialog").getByRole("alert")).toHaveTextContent("Another tab is editing this project. Rename it there, or open it here and take over editing.");
  await expect.element(screen.getByRole("button", { name: "Owner project", exact: true })).toBeVisible();
});


test("a project row keeps its dialog open when pending work cannot be saved", async () => {
  ready();
  const store = testPersistence({ quietMs: 60_000 });
  const a = await createProject(makeRecipe({}, catalog), "Target");
  if (!a.ok) throw new Error(a.error);
  await createProject(makeRecipe({}, catalog), "Current");
  const summary = (await store.listProjects()).find((row) => row.id === a.value.id);
  if (!summary) throw new Error("Missing target row");
  const close = vi.fn();
  const screen = await renderWithStudio(<ul><ProjectRow summary={summary} onClose={close} /></ul>, { project: doc.get() });
  doc.apply("Pending work", (project) => ({ project: { ...project, name: "Unsaved" }, changed: true, summary: "Pending work" }));
  const before = doc.get();
  const put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
    if (this.name === "projects") throw new DOMException("Full", "QuotaExceededError");
    return put.apply(this, args);
  });
  onCleanup(() => spy.mockRestore());
  await screen.getByRole("button", { name: "Target", exact: true }).click();
  await vi.waitFor(() => expect(store.projects.saveStatus().state).toBe("not-saved"));
  expect(doc.get()).toBe(before);
  expect(close).not.toHaveBeenCalled();
});
