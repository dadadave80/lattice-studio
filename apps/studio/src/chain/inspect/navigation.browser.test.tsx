import { encodeShareLink } from "@lattice-studio/core";
import { makeRecipe } from "@lattice-studio/core/testing";
import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { createProject, doc, runCommand, session, toast } from "@/contracts";
import { openShareLink, resetOpenLink } from "@/flows/open-link";
import { testPersistence } from "@/persist/testing";
import { openStoredProject, startNewProject } from "@/projects/actions";
import { openImportedFile } from "@/projects/import-file";
import { DialogHost } from "@/ui/overlays/DialogHost";
import { App } from "@/app/App";
import { InspectorPanel } from "@/panels/inspector/InspectorPanel";
import { fixtureCatalog, renderWithStudio } from "../../../test/harness";
import { getInspectionEngine } from "./app";

const ADDRESS = "0x00000000000000000000000000000000000000aa";
const target = { kind: "deployed", chainId: 11155111, address: ADDRESS } as const;
const hash = `#d=11155111:${ADDRESS}`;
const catalog = fixtureCatalog();
const incoming = makeRecipe({ name: "Incoming" }, catalog);

afterEach(() => {
  vi.restoreAllMocks();
  resetOpenLink();
  getInspectionEngine().invalidate();
  history.replaceState(null, "", `${location.pathname}${location.search}`);
});

function inspecting() {
  history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
  session.set((state) => ({ panes: { ...state.panes, inspector: { ...state.panes.inspector, view: target } } }));
}

test("project.open without an id opens the unified dialog and Cancel retains inspection", async () => {
  await renderWithStudio(<DialogHost />);
  inspecting();
  const before = doc.get();
  expect((await runCommand({ id: "project.open" }, "keys")).ok).toBe(true);
  await expect.element(page.getByRole("dialog", { name: "Open", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(location.hash).toBe(hash);
  expect(session.get().panes.inspector.view).toEqual(target);
  expect(doc.get()).toBe(before);
});

test.each(["new", "stored", "file", "share"] as const)("successful %s replacement returns to composition and clears the diamond route", async (operation) => {
  await renderWithStudio(<div />);
  testPersistence();
  const saved = await createProject(incoming, "Stored");
  if (!saved.ok) throw new Error(saved.error);
  const current = await createProject(makeRecipe({}, catalog), "Current");
  if (!current.ok) throw new Error(current.error);
  inspecting();
  const before = doc.get();
  if (operation === "new") await startNewProject();
  else if (operation === "stored") await openStoredProject(saved.value.id);
  else if (operation === "file") await openImportedFile("incoming.json", JSON.stringify(incoming));
  else await openShareLink(encodeShareLink(incoming).fragment);
  expect(doc.get()).not.toBe(before);
  expect(location.hash).toBe("");
  expect(session.get().panes.inspector.view).toBeNull();
});

test.each(["new", "stored", "file", "share"] as const)("failed pending save during %s replacement preserves the document and inspected route", async (operation) => {
  await renderWithStudio(<div />);
  testPersistence({ quietMs: 60_000 });
  const saved = await createProject(incoming, "Stored");
  if (!saved.ok) throw new Error(saved.error);
  const current = await createProject(makeRecipe({}, catalog), "Current");
  if (!current.ok) throw new Error(current.error);
  doc.apply("Pending edit", (project) => ({ project: { ...project, name: "Pending work" }, changed: true, summary: "Pending edit" }));
  inspecting();
  const before = doc.get();
  const put = IDBObjectStore.prototype.put;
  const fail = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
    if (this.name === "projects") throw new DOMException("Injected failure", "QuotaExceededError");
    return put.apply(this, args);
  });
  if (operation === "new") await startNewProject();
  else if (operation === "stored") await openStoredProject(saved.value.id);
  else if (operation === "file") await openImportedFile("incoming.json", JSON.stringify(incoming));
  else await openShareLink(encodeShareLink(incoming).fragment);
  expect(doc.get()).toBe(before);
  expect(location.hash).toBe(hash);
  expect(session.get().panes.inspector.view).toEqual(target);
  fail.mockRestore();
});

test("an invalid file or share link keeps the inspected route", async () => {
  await renderWithStudio(<div />);
  inspecting();
  const before = doc.get();
  await openImportedFile("bad.json", "{");
  await openShareLink("#s=1.bad");
  expect(doc.get()).toBe(before);
  expect(location.hash).toBe(hash);
  expect(session.get().panes.inspector.view).toEqual(target);
});

test("composition selection keeps the deployed task and its footer stays hidden", async () => {
  await renderWithStudio(<InspectorPanel />, { chain: true, session: { panes: { ...session.get().panes, inspector: { open: true, size: 316, view: target } } } });
  await expect.poll(() => document.querySelector('[data-inspector-view="deployed"]') !== null).toBe(true);
  session.set({ selection: ["ERC20"], coreSelected: true });
  await Promise.resolve();
  expect(session.get().panes.inspector.view).toEqual(target);
  expect(document.querySelector("[data-inspector-plan]")).toBeNull();
  expect(document.querySelector("[data-narrow-fill-in]")).toBeNull();
});

test.each(["pointer", "keyboard"] as const)("opening a diamond by %s above a retained toast moves phone navigation and heading focus", async (input) => {
  await page.viewport(375, 812);
  try {
    await renderWithStudio(<App />, { chain: true, session: { chainId: 11155111 } });
    const before = doc.get();
    toast({ text: "A retained error before opening a diamond.", kind: "error" });
    await runCommand({ id: "project.open" }, "keys");
    const dialog = page.getByRole("dialog", { name: "Open", exact: true });
    await dialog.getByRole("textbox", { name: "Address, name or link" }).fill(ADDRESS);
    if (input === "pointer") await dialog.getByRole("button", { name: "Inspect diamond", exact: true }).click();
    else await userEvent.keyboard("{Enter}");
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.poll(() => session.get().panes.narrow).toBe("inspector");
    await expect.element(page.getByRole("heading", { name: "Deployed diamond", exact: true })).toHaveFocus();
    expect(doc.get()).toBe(before);
    expect(location.hash).toMatch(/^#d=11155111:/);
  } finally {
    await page.viewport(1440, 900);
  }
});
