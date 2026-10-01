/**
 * Persistence against the browser's real IndexedDB, Web Locks and BroadcastChannel. Each test has its own
 * database (`testPersistence`); two instances on one database play two tabs.
 */
import { CORE_FACETS, toChecksum, type Catalog, type Deployment, type Project, type Recipe } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { openDB } from "idb";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createProject, deleteDeployment, doc, getCatalogStatus, listDeployments, loadViewport, openProject, provideServices,
  putDeployment, saveStatus, saveViewport, setCatalogStatus, settings, subscribeDeployments, type SaveStatus,
} from "@/contracts";
import { isUnpinned, UNPINNED_HASH } from "@/state/document-store";
import { bufferedServices, fakeClock, fixtureCatalog, onCleanup } from "../../test/harness";
import { META, openStudioDb } from "./db";
import { bootPersistence, clearOpenFailure, editLockState, openFailure, persistence, subscribeEditLock } from "./index";
import type { Persistence } from "./persistence";
import { deleteDB } from "idb";
import { createEditLock, STILL_SAVING } from "./lock";
import { openChannel, type Channel, type ChannelMessage } from "./channel";
import { fakeDoc, testPersistence, type FakeDoc } from "./testing";

const realTimeout = globalThis.setTimeout.bind(globalThis);
const DAY = 24 * 60 * 60 * 1000;

/** Waits (on real timers, even while fake ones are installed) until `check` passes. */
async function until(check: () => boolean | Promise<boolean>, what = "condition"): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (await check()) return;
    await new Promise((resolve) => realTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

function nextStatus(store: Persistence, state: SaveStatus["state"]): Promise<SaveStatus> {
  return new Promise((resolve) => {
    const stop = store.projects.subscribeSaveStatus((status) => {
      if (status.state !== state) return;
      stop();
      resolve(status);
    });
  });
}

function rename(name: string): void {
  doc.apply(`Renamed to ${name}`, (p) => ({ project: { ...p, name }, changed: p.name !== name, summary: `Renamed to ${name}` }));
}

async function storedName(store: Persistence, id: string): Promise<string | undefined> {
  return (await store.listProjects()).find((p) => p.id === id)?.name;
}

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

// Core only, as every stored project is once C1 reads it (a recipe without the core gains it on the way in).
const recipe: Recipe = makeRecipe({ facets: [...CORE_FACETS] });

/** Another tab on the same database: it boots on its own untitled document, then opens `project`. */
async function otherTab(
  first: Persistence, project: Project, options: Parameters<typeof testPersistence>[0] = {},
): Promise<{ tab: Persistence; tabDoc: FakeDoc }> {
  const tabDoc = fakeDoc(makeProject({ id: "untitled" }));
  const tab = testPersistence({ dbName: first.dbName, doc: tabDoc, provide: false, page: null, ...options });
  const opened = await tab.projects.openProject(project.id);
  if (!opened.ok) throw new Error(opened.error);
  return { tab, tabDoc };
}

async function created(name = "Vault"): Promise<Project> {
  const result = await createProject(recipe, name);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("autosave", () => {
  test("writes after 750 ms of quiet; every edit restarts the wait", async () => {
    const store = testPersistence();
    const project = await created();
    expect(await storedName(store, project.id)).toBe("Vault");
    expect(saveStatus()).toEqual({ state: "saved", text: "Saved" });

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    rename("Vault 2");
    expect(saveStatus()).toEqual({ state: "saving", text: "Saving…" });
    vi.advanceTimersByTime(500);
    rename("Vault 3");
    vi.advanceTimersByTime(749);
    expect(await storedName(store, project.id)).toBe("Vault");

    const saved = nextStatus(store, "saved");
    vi.advanceTimersByTime(1);
    expect(await saved).toEqual({ state: "saved", text: "Saved" });
    expect(await storedName(store, project.id)).toBe("Vault 3");
  });

  test("doc.record saves like any edit", async () => {
    const store = testPersistence();
    const project = await created();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    doc.record("New salt", (p) => ({
      project: { ...p, deploy: { ...p.deploy, entropy: `0x${"ab".repeat(11)}` } }, changed: true, summary: "New salt",
    }));
    const saved = nextStatus(store, "saved");
    vi.advanceTimersByTime(750);
    await saved;
    const stored = (await store.listProjects()).find((p) => p.id === project.id);
    expect(stored?.project.deploy.entropy).toBe(`0x${"ab".repeat(11)}`);
  });

  test("flushes at once when the tab hides", async () => {
    const store = testPersistence();
    const project = await created();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    rename("Hidden");
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    onCleanup(() => void Reflect.deleteProperty(document, "visibilityState"));
    const saved = nextStatus(store, "saved");
    document.dispatchEvent(new Event("visibilitychange"));
    await saved;
    expect(await storedName(store, project.id)).toBe("Hidden");
  });

  test("flushes at once on pagehide", async () => {
    const store = testPersistence();
    const project = await created();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    rename("Closing");
    const saved = nextStatus(store, "saved");
    const transaction = vi.spyOn(IDBDatabase.prototype, "transaction");
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
    // Queued before the handler returned: nothing waits on a promise first (spec L498, L845).
    expect(transaction).toHaveBeenCalledWith(["projects", "meta", "trash"], "readwrite");
    await saved;
    expect(await storedName(store, project.id)).toBe("Closing");
  });

  test("a full browser storage says so and offers Save a copy…, then recovers", async () => {
    const store = testPersistence();
    const project = await created();
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "projects") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return put.apply(this, args);
    });
    rename("Too big");
    await store.flush();
    expect(saveStatus()).toEqual({
      state: "not-saved", text: "Not saved: browser storage is full", action: { id: "project.saveCopy" },
    });
    expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Error", text: "Not saved: browser storage is full." });
    expect(await storedName(store, project.id)).toBe("Vault");

    spy.mockRestore();
    rename("Fits again");
    await store.flush();
    expect(saveStatus()).toEqual({ state: "saved", text: "Saved" });
    expect(await storedName(store, project.id)).toBe("Fits again");
  });

  test("a full browser storage is announced assertively, once until a save works again (spec L777)", async () => {
    const announced = vi.fn();
    onCleanup(provideServices({ announce: announced }));
    const store = testPersistence();
    await created();
    const put = IDBObjectStore.prototype.put;
    let full = true;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (full && this.name === "projects") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return put.apply(this, args);
    });
    const FULL: [string, { politeness: "assertive" }] = ["Not saved: browser storage is full.", { politeness: "assertive" }];
    const fullCalls = () => announced.mock.calls.filter(([text]) => text === FULL[0]);

    rename("Too big");
    await store.flush();
    rename("Still too big");
    await store.flush();
    expect(fullCalls()).toEqual([FULL]);

    full = false;
    rename("Fits again");
    await store.flush();
    expect(saveStatus()).toEqual({ state: "saved", text: "Saved" });
    full = true;
    rename("Too big again");
    await store.flush();
    expect(fullCalls()).toEqual([FULL, FULL]);
  });

  test("another failed save isn't announced assertively", async () => {
    const announced = vi.fn();
    onCleanup(provideServices({ announce: announced }));
    const store = testPersistence();
    await created();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "projects") throw new DOMException("The disk broke.", "UnknownError");
      return put.apply(this, args);
    });
    rename("Broken");
    await store.flush();
    expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Error", text: "Not saved: The disk broke." });
    expect(announced.mock.calls.filter(([, options]) => options?.politeness === "assertive")).toEqual([]);
  });

  test("switching the document to another project writes the previous one's pending save first", async () => {
    const store = testPersistence({ quietMs: 60_000 });
    const project = await created("Vault");
    rename("Unsaved edit");
    doc.load(makeProject({ id: "migrated", name: "Next", recipe }));
    await store.flush();
    expect(await storedName(store, project.id)).toBe("Unsaved edit");
    expect(await storedName(store, "migrated")).toBe("Next");
  });

  test("a project loaded from elsewhere (a link, a migration) is adopted and saved", async () => {
    const store = testPersistence();
    const shared = makeProject({ id: "shared-1", name: "GovernedVault (shared)", recipe });
    doc.load(shared);
    await store.flush();
    expect(await storedName(store, "shared-1")).toBe("GovernedVault (shared)");
    expect(editLockState()).toEqual({ state: "held", projectId: "shared-1" });
  });
});

describe("projects", () => {
  test("open reads a stored project back through C1 and remembers it as the last one", async () => {
    const store = testPersistence();
    const first = await created("First");
    const second = await created("Second");
    expect(doc.get().id).toBe(second.id);
    const opened = await openProject(first.id);
    expect(opened).toEqual({ ok: true, value: first });
    expect(doc.get()).toEqual(first);

    const other = testPersistence({ dbName: store.dbName, doc: fakeDoc(makeProject({ id: "untitled" })), provide: false, page: null });
    expect(await other.openLastProject()).toMatchObject({ ok: true, value: { id: first.id } });
  });

  test("a stored project from a newer Studio is refused with the version it needs", async () => {
    const store = testPersistence();
    await created();
    const db = await openStudioDb(store.dbName, { onVersionChange: () => {} });
    const newer = { ...makeProject({ id: "future", recipe }), recipe: { ...recipe, schemaVersion: 2 } };
    await db.put("projects", { id: "future", savedAt: 1, project: newer });
    db.close();
    expect(await openProject("future")).toEqual({
      ok: false, error: "This project needs Studio schema v2. This Studio reads v1.",
    });
    // Listed nowhere, but kept, and said once.
    expect((await store.listProjects()).map((p) => p.id)).not.toContain("future");
    await store.listProjects();
    const lines = bufferedServices().log.filter((l) => l.text.includes("future"));
    expect(lines).toEqual([expect.objectContaining({
      tag: "Error", text: "Couldn't read the stored project future. This project needs Studio schema v2. This Studio reads v1.",
    })]);
  });

  test("rename, duplicate and the projects list, recent first", async () => {
    const clock = fakeClock({ at: "2026-09-23T12:00:00Z" });
    const store = testPersistence();
    const a = await created("Alpha");
    clock.advance(1000);
    const b = await created("Beta");
    expect((await store.listProjects()).map((p) => p.name)).toEqual(["Beta", "Alpha"]);
    expect(await store.renameProject(b.id, "Other")).toEqual({
      ok: false, error: "This project is open. Rename it in the title bar.",
    });
    expect(await store.renameProject(a.id, "Alpha 2")).toMatchObject({ ok: true, value: { name: "Alpha 2" } });
    const copy = await store.duplicateProject(a.id);
    if (!copy.ok) throw new Error(copy.error);
    expect(copy.value).toMatchObject({ name: "Alpha 2 copy", recipe: a.recipe, predicted: [] });
    expect(copy.value.id).not.toBe(a.id);
    expect(copy.value.deploy.entropy).not.toBe(a.deploy.entropy);
    expect((await store.listProjects()).map((p) => p.name)).toEqual(["Alpha 2 copy", "Beta", "Alpha 2"]);
  });

  test("an imported project file opens as a new project; its records keep From file and never overwrite", async () => {
    const store = testPersistence();
    const live = await created("Live");
    await putDeployment(deployment(live.id, 1));
    const file = makeProject({ id: "from-disk", name: "GovernedVault", recipe });
    const imported = await store.importProject(file, [
      deployment("from-disk", 1, { status: "pending" }),
      deployment("from-disk", 2),
    ]);
    if (!imported.ok) throw new Error(imported.error);
    const { project, added, skipped } = imported.value;
    expect([added, skipped]).toEqual([1, 1]);
    expect(project.id).not.toBe("from-disk");
    expect(doc.get()).toEqual(project);
    expect(await listDeployments(project.id)).toEqual([
      { ...deployment(project.id, 2), fromFile: true },
    ]);
    expect(await listDeployments(live.id)).toEqual([deployment(live.id, 1)]);
  });

  test("export all has everything clear data counts: Recently deleted, unreadable projects, orphan records", async () => {
    const store = testPersistence();
    const a = await created("Alpha");
    await putDeployment(deployment(a.id, 1));
    await putDeployment(deployment(a.id, 2, { status: "failed" }));
    const b = await created("Beta");
    await putDeployment(deployment(b.id, 3));
    await store.deleteProject(a.id);
    // A project from a newer Studio, with a record, and a record whose project is gone.
    const db = await openStudioDb(store.dbName, { onVersionChange: () => {} });
    const newer = { ...makeProject({ id: "future", name: "Future", recipe }), recipe: { ...recipe, schemaVersion: 2 } };
    await db.put("projects", { id: "future", savedAt: 1, project: newer });
    db.close();
    await putDeployment(deployment("future", 4));
    await putDeployment(deployment("expired", 5));

    const files = await store.exportAll();
    expect(files.map((f) => f.filename).sort()).toEqual([
      "alpha.lattice.json", "beta.lattice.json", "records-expired.json", "unreadable-future.lattice.json",
    ]);
    const read = (name: string) => JSON.parse(files.find((f) => f.filename === name)?.text ?? "{}") as {
      project?: unknown; projectId?: string; deployments: Deployment[];
    };
    expect(read("alpha.lattice.json").deployments).toHaveLength(2);
    expect(read("unreadable-future.lattice.json")).toEqual({ project: newer, deployments: [deployment("future", 4)] });
    expect(read("records-expired.json")).toEqual({ projectId: "expired", deployments: [deployment("expired", 5)] });
    const exported = files.reduce((n, f) => n + read(f.filename).deployments.length, 0);

    const counts = await store.clearDataCounts();
    expect(counts).toEqual({ projects: 2, trashed: 1, records: 5, deployed: 4 });
    expect(exported).toBe(counts.records);
    await store.clearData();
    expect(await store.clearDataCounts()).toEqual({ projects: 0, trashed: 0, records: 0, deployed: 0 });
    rename("Not resurrected");
    await store.flush();
    expect(await store.listProjects()).toEqual([]);
    expect(saveStatus()).toEqual({ state: "not-saved", text: "Not saved", detail: "Studio's data in this browser was cleared." });
  });
});

describe("Recently deleted", () => {
  test("keeps a project for 30 days; then it goes, but its records (except failed ones) stay", async () => {
    const clock = fakeClock({ at: "2026-09-23T12:00:00Z" });
    const store = testPersistence();
    const keep = await created("Keep");
    const gone = await created("Gone");
    await putDeployment(deployment(gone.id, 1));
    await putDeployment(deployment(gone.id, 2, { status: "failed" }));
    await openProject(keep.id);

    expect(await store.deleteProject(gone.id)).toEqual({ ok: true, value: { records: 2, deployed: 1 } });
    expect((await store.listProjects()).map((p) => p.name)).toEqual(["Keep"]);
    expect(await listDeployments(gone.id)).toEqual([]);
    const [entry] = await store.listTrash();
    expect(entry).toMatchObject({ id: gone.id, name: "Gone", expiresAt: clock.now() + 30 * DAY });
    expect(await store.trashCounts(gone.id)).toEqual({ records: 2, deployed: 1 });

    clock.advance(30 * DAY - 1);
    expect((await store.listTrash()).map((t) => t.id)).toEqual([gone.id]);
    clock.advance(1);
    expect(await store.listTrash()).toEqual([]);
    expect(await store.trashCounts(gone.id)).toBeNull();
    expect(await listDeployments(gone.id)).toEqual([deployment(gone.id, 1)]);
    expect(await store.clearDataCounts()).toMatchObject({ records: 1, deployed: 1 });
    expect(await store.restoreProject(gone.id)).toEqual({ ok: false, error: "This project isn't in Recently deleted." });
  });

  test("restore brings the records back; delete for good counts what goes", async () => {
    const store = testPersistence();
    const a = await created("Alpha");
    await putDeployment(deployment(a.id, 1));
    await created("Beta");
    await store.deleteProject(a.id);
    const restored = await store.restoreProject(a.id);
    expect(restored).toMatchObject({ ok: true, value: { project: { id: a.id, name: "Alpha" }, restored: 1, skipped: 0 } });
    expect(await listDeployments(a.id)).toEqual([deployment(a.id, 1)]);

    await store.deleteProject(a.id);
    expect(await store.deleteForGood(a.id)).toEqual({ ok: true, value: { records: 1, deployed: 1 } });
    expect(await store.listTrash()).toEqual([]);
    expect(await store.clearDataCounts()).toMatchObject({ records: 0 });
  });

  test("restore counts records whose address another project holds now, and never replaces a newer copy", async () => {
    const store = testPersistence();
    const a = await created("Alpha");
    await putDeployment(deployment(a.id, 1));
    await putDeployment(deployment(a.id, 2));
    const b = await created("Beta");
    await store.deleteProject(a.id);
    await putDeployment(deployment(b.id, 1));
    expect(await store.restoreProject(a.id)).toMatchObject({ ok: true, value: { restored: 1, skipped: 1 } });
    expect(bufferedServices().log.at(-1)).toMatchObject({
      tag: "Note", text: "Restored Alpha. 1 of its deployment records stays with the project that holds that address now.",
    });
    expect(await listDeployments(b.id)).toEqual([deployment(b.id, 1)]);

    await store.deleteProject(a.id);
    const db = await openStudioDb(store.dbName, { onVersionChange: () => {} });
    await db.put("projects", { id: a.id, savedAt: 2, project: { ...a, name: "Alpha, newer" } });
    db.close();
    expect(await store.restoreProject(a.id)).toEqual({
      ok: false, error: "A newer copy of this project is already in your projects. Recently deleted keeps this one.",
    });
    expect(await storedName(store, a.id)).toBe("Alpha, newer");
    expect((await store.listTrash()).map((t) => t.id)).toEqual([a.id]);
  });

  test("deleting the open project doesn't write it back", async () => {
    const store = testPersistence();
    const a = await created("Alpha");
    rename("Alpha edited");
    expect(await store.deleteProject(a.id)).toMatchObject({ ok: true });
    expect(saveStatus()).toEqual({ state: "saved", text: "Saved" });
    rename("After delete");
    await store.flush();
    expect(await store.listProjects()).toEqual([]);
    expect((await store.listTrash())[0]?.name).toBe("Alpha edited");
    expect(saveStatus()).toEqual({
      state: "not-saved", text: "Not saved", detail: "This project is in Recently deleted. Restore it to keep saving.",
    });

    await store.restoreProject(a.id);
    await store.flush();
    expect(await storedName(store, a.id)).toBe("After delete");
    expect(saveStatus()).toEqual({ state: "saved", text: "Saved" });
  });
});

describe("two tabs", () => {
  test("the second tab opens read-only; take over flushes the first tab's pending save and hands the lock over", async () => {
    // The first tab waits a minute before autosaving, so only the handover can have written its edit.
    const first = testPersistence({ quietMs: 60_000 });
    const project = await created("Vault");
    const { tab: second, tabDoc: secondDoc } = await otherTab(first, project);
    expect(second.editLock()).toEqual({ state: "elsewhere", projectId: project.id });
    expect(second.projects.saveStatus()).toEqual({
      state: "read-only", text: "Read-only", detail: "Another tab is editing this project",
    });

    const firstLock: string[] = [];
    onCleanup(subscribeEditLock((state) => firstLock.push(state.state)));
    rename("Edited in the first tab");
    await until(() => secondDoc.get().name === "Edited in the first tab", "the edit to reach the second tab");
    expect(await storedName(first, project.id)).toBe("Vault");

    const taken = await second.takeOverEditing();
    expect(taken).toMatchObject({ ok: true, value: { name: "Edited in the first tab" } });
    expect(await storedName(first, project.id)).toBe("Edited in the first tab");
    expect(second.editLock()).toEqual({ state: "held", projectId: project.id });
    expect(first.editLock()).toEqual({ state: "handed-over", projectId: project.id });
    expect(firstLock.at(-1)).toBe("handed-over");
    expect(saveStatus()).toEqual({ state: "read-only", text: "Read-only", detail: "Editing moved to another tab" });

    // Now the second tab edits and saves; its edits reach the first.
    secondDoc.edit("Renamed", (p) => ({ ...p, name: "Edited in the second tab" }));
    await second.flush();
    expect(await storedName(second, project.id)).toBe("Edited in the second tab");
    await until(() => doc.get().name === "Edited in the second tab", "the edit to reach the first tab");

    // Take back editing.
    const back = await first.takeOverEditing();
    expect(back).toMatchObject({ ok: true, value: { name: "Edited in the second tab" } });
    expect(bufferedServices().log.at(-1)).toMatchObject({
      tag: "Note", text: "Took over editing from another tab. Undo history starts here.",
    });
    expect(first.editLock()).toEqual({ state: "held", projectId: project.id });
    expect(second.editLock()).toEqual({ state: "handed-over", projectId: project.id });
  });

  test("a holder that doesn't answer has the lock stolen after a wait", async () => {
    const store = testPersistence({ stealAfter: 50 });
    const project = await created();
    // A frozen tab: holds the lock and never hears the channel.
    await store.close();
    let letGo: () => void = () => {};
    const frozen = navigator.locks.request(`${store.dbName}:edit:${project.id}`, () => new Promise<void>((r) => (letGo = r)));
    onCleanup(() => letGo());
    const frozenLost = frozen.then(() => "released", (error: unknown) => (error as DOMException).name);

    const { tab } = await otherTab(store, project, { stealAfter: 50 });
    expect(tab.editLock().state).toBe("elsewhere");
    expect(await tab.takeOverEditing()).toMatchObject({ ok: true, value: { id: project.id } });
    expect(tab.editLock()).toEqual({ state: "held", projectId: project.id });
    expect(await frozenLost).toBe("AbortError");
  });

  test("a demoted tab still records deployments, and the other tab hears it", async () => {
    const first = testPersistence();
    const project = await created("Vault");
    const { tab: second } = await otherTab(first, project);
    await second.takeOverEditing();
    expect(first.editLock().state).toBe("handed-over");

    const heardHere: string[] = [];
    const heardThere: string[] = [];
    onCleanup(subscribeDeployments((id) => heardHere.push(id)));
    onCleanup(second.deployments.subscribe((id) => heardThere.push(id)));
    await putDeployment(deployment(project.id, 7, { status: "pending", tx: `0x${"44".repeat(32)}` }));

    expect(await second.deployments.listDeployments(project.id)).toEqual([
      deployment(project.id, 7, { status: "pending", tx: `0x${"44".repeat(32)}` }),
    ]);
    expect(heardHere).toEqual([project.id]);
    await until(() => heardThere.length > 0, "the other tab to hear the write");
    expect(heardThere).toEqual([project.id]);
  });

  test("a record's key is [chainId, address] in EIP-55 form, whatever case it arrives in", async () => {
    testPersistence();
    const project = await created();
    const record = deployment(project.id, 5);
    await putDeployment({ ...record, address: record.address.toLowerCase() as `0x${string}` });
    await putDeployment({ ...record, status: "mismatch" });
    expect(await listDeployments(project.id)).toEqual([{ ...record, status: "mismatch" }]);
  });

  test("a newer Studio upgrading the database closes this tab's connection and asks to reload", async () => {
    const store = testPersistence();
    const project = await created();
    const upgraded = await openDB(store.dbName, 2);
    onCleanup(() => upgraded.close());
    await until(() => bufferedServices().banners.has("persist.updated"), "the reload banner");
    expect(bufferedServices().banners.get("persist.updated")).toEqual({
      text: "A new version of Studio is ready", tone: "info", actions: [{ id: "app.reload" }],
    });
    // Everything was saved before closing; the lock is free for the new version's tab.
    expect(saveStatus()).toEqual({ state: "saved", text: "Saved" });
    expect(editLockState()).toEqual({ state: "none" });
    rename("After the upgrade");
    expect(saveStatus()).toEqual({
      state: "not-saved", text: "Not saved", detail: "A new version of Studio is ready", action: { id: "project.saveCopy" },
    });
    // Reload would discard the edit now, so it isn't offered.
    expect(bufferedServices().banners.has("persist.updated")).toBe(false);
    // A receipt still gets recorded.
    await putDeployment(deployment(project.id, 8));
    expect(await upgraded.getAll("deployments")).toEqual([deployment(project.id, 8)]);
  });
});

describe("boot", () => {
  test("on the app's own document, a returning visitor lands in their last project", async () => {
    const earlier = testPersistence();
    const a = await created("Alpha");
    await earlier.close();

    doc.load(makeProject({ id: "untitled", name: "Untitled", recipe }));
    testPersistence({ dbName: earlier.dbName, start: false });
    expect(await bootPersistence()).toMatchObject({ ok: true, value: { id: a.id, name: "Alpha" } });
    expect(doc.get()).toMatchObject({ id: a.id, name: "Alpha" });
    expect(editLockState()).toEqual({ state: "held", projectId: a.id });
  });

  test("on the app's own document, a second fresh tab reaches the first tab's work read-only", async () => {
    const firstDoc = fakeDoc(makeProject({ id: "untitled", recipe }));
    const first = testPersistence({ doc: firstDoc, provide: false, page: null });
    firstDoc.edit("Renamed", (p) => ({ ...p, name: "First tab's work" }));
    await first.flush();

    doc.load(makeProject({ id: "untitled", name: "Untitled", recipe }));
    testPersistence({ dbName: first.dbName, start: false });
    expect(await bootPersistence()).toMatchObject({ ok: true, value: { name: "First tab's work" } });
    expect(doc.get().name).toBe("First tab's work");
    expect(editLockState()).toEqual({ state: "elsewhere", projectId: firstDoc.get().id });
  });

  test("a last project that can't be opened shows the sheet's error state, logged once (spec L696)", async () => {
    onCleanup(clearOpenFailure);
    const earlier = testPersistence();
    await created("Alpha");
    const db = await openStudioDb(earlier.dbName, { onVersionChange: () => {} });
    const newer = { ...makeProject({ id: "future", recipe }), recipe: { ...recipe, schemaVersion: 2 } };
    await db.put("projects", { id: "future", savedAt: Date.now() + DAY, project: newer });
    await db.put("meta", "future", META.lastProject);
    db.close();
    await earlier.close();

    doc.load(makeProject({ id: "untitled", name: "Untitled", recipe }));
    testPersistence({ dbName: earlier.dbName, start: false });
    const reason = "This project needs Studio schema v2. This Studio reads v1.";
    expect(await bootPersistence()).toEqual({ ok: false, error: reason });
    const text = `This project couldn't be opened: ${reason}`;
    expect(openFailure()).toEqual({ text, reason, details: `${text}\nWhile reopening your last project on load.` });
    expect(bufferedServices().log.filter((l) => l.text.includes(reason) && !l.text.startsWith("Couldn't read"))).toEqual([
      expect.objectContaining({ tag: "Error", text }),
    ]);
    // The untitled document stays; opening another project ends the error state.
    expect(doc.get().name).toBe("Untitled");
    doc.load(makeProject({ id: "other", name: "Other", recipe }));
    expect(openFailure()).toBeNull();
  });

  test("a returning visitor lands in their last project", async () => {
    const store = testPersistence();
    const a = await created("Alpha");
    await created("Beta");
    await openProject(a.id);
    await store.close();

    const tabDoc = fakeDoc(makeProject({ id: "untitled" }));
    testPersistence({ dbName: store.dbName, doc: tabDoc, start: false, page: null });
    expect(await bootPersistence()).toMatchObject({ ok: true, value: { id: a.id, name: "Alpha" } });
    expect(tabDoc.get()).toMatchObject({ id: a.id, name: "Alpha" });
  });

  /**
   * The app's own document as it boots: an untitled project that names no catalog, with the catalog still
   * loading. Returns what loads the catalog, as the manifest's fetch would (then `state/pinning.ts` pins).
   */
  function bootUntitled(): () => Catalog {
    const previous = getCatalogStatus();
    onCleanup(() => setCatalogStatus(previous));
    setCatalogStatus({ status: "loading" });
    doc.load(makeProject({ id: "untitled", name: "Untitled", recipe: { ...recipe, catalog: { tag: "", hash: UNPINNED_HASH } } }));
    return () => {
      const catalog = fixtureCatalog();
      setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
      return catalog;
    };
  }

  /** Holds `tab`'s storage read back until `answer()`; `asked` settles once the boot has started it. */
  function slowStorage(tab: Persistence): { asked: Promise<void>; answer: () => void } {
    const read = tab.openLastProject.bind(tab);
    let answer = (): void => {};
    let ask = (): void => {};
    const answered = new Promise<void>((resolve) => (answer = resolve));
    const asked = new Promise<void>((resolve) => (ask = resolve));
    vi.spyOn(tab, "openLastProject").mockImplementation(async (proceed) => {
      ask();
      await answered;
      return read(proceed);
    });
    return { asked, answer };
  }

  test("a returning visitor lands in their last project when the catalog loads before storage answers", async () => {
    const earlier = testPersistence();
    const a = await created("Alpha");
    await earlier.close();

    const loadCatalog = bootUntitled();
    const tab = testPersistence({ dbName: earlier.dbName, start: false });
    const storage = slowStorage(tab);
    const booting = bootPersistence();
    await storage.asked;
    const catalog = loadCatalog();
    await until(() => !isUnpinned(doc.get().recipe), "the catalog pin");
    expect(doc.get().recipe.catalog).toEqual({ tag: catalog.lattice.tag, hash: catalog.hash });
    storage.answer();

    expect(await booting).toMatchObject({ ok: true, value: { id: a.id, name: "Alpha" } });
    expect(doc.get()).toMatchObject({ id: a.id, name: "Alpha", recipe: { catalog: a.recipe.catalog } });
    expect(editLockState()).toEqual({ state: "held", projectId: a.id });
    // The pinned untitled document was left unsaved: no stray Untitled project.
    await tab.flush();
    expect((await tab.listProjects()).map((p) => p.id)).toEqual([a.id]);
  });

  test("a returning visitor lands in their last project when storage answers before the catalog loads", async () => {
    const earlier = testPersistence();
    const a = await created("Alpha");
    await earlier.close();

    const loadCatalog = bootUntitled();
    testPersistence({ dbName: earlier.dbName, start: false });
    expect(await bootPersistence()).toMatchObject({ ok: true, value: { id: a.id, name: "Alpha" } });
    const catalog = loadCatalog();
    await new Promise((resolve) => realTimeout(resolve, 0));
    // The opened project keeps the catalog it names.
    expect(doc.get()).toMatchObject({ id: a.id, name: "Alpha", recipe: { catalog: a.recipe.catalog } });
    expect(doc.get().recipe.catalog.hash).not.toBe(catalog.hash);
  });

  test.each([
    ["a rename", () => rename("My own")],
    ["a recipe edit", () =>
      doc.apply("Placed Extra", (p) => ({
        project: { ...p, recipe: { ...p.recipe, facets: [...p.recipe.facets, "Extra"] } },
        changed: true,
        summary: "Placed Extra",
      }))],
  ])("%s after the catalog pin keeps the visitor in their document", async (_, edit) => {
    const earlier = testPersistence();
    const a = await created("Alpha");
    await earlier.close();

    const loadCatalog = bootUntitled();
    const tab = testPersistence({ dbName: earlier.dbName, start: false });
    const storage = slowStorage(tab);
    const booting = bootPersistence();
    await storage.asked;
    loadCatalog();
    await until(() => !isUnpinned(doc.get().recipe), "the catalog pin");
    edit();
    storage.answer();

    expect(await booting).toBeNull();
    expect(doc.get().id).not.toBe(a.id);
  });

  /** A wallet that reconnects on load: the prediction `state/prediction.ts` records, and nothing else. */
  function recordPrediction(): void {
    doc.record("Recorded the predicted address", (p) => ({
      project: { ...p, predicted: [...p.predicted, { chainId: 11155111, address: address(3) }] }, changed: true,
      summary: "Recorded the predicted address",
    }));
  }

  async function storedIds(store: Persistence): Promise<string[]> {
    return (await store.listProjects()).map((p) => p.id);
  }

  test.each([
    ["a recorded prediction", recordPrediction],
    ["the catalog pin", (loadCatalog: () => Catalog) => void loadCatalog()],
  ])("%s 750 ms before storage answers leaves no stray Untitled project", async (_, change) => {
    const earlier = testPersistence();
    const a = await created("Alpha");
    await earlier.close();

    const loadCatalog = bootUntitled();
    const tab = testPersistence({ dbName: earlier.dbName, start: false });
    const storage = slowStorage(tab);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const booting = bootPersistence();
    await storage.asked;
    await until(() => editLockState().state === "held", "the boot document's lock");
    const before = doc.get();
    change(loadCatalog);
    await until(() => doc.get() !== before, "the change");
    expect(saveStatus()).toEqual({ state: "saved", text: "Saved" });
    // Autosave's quiet period ends while storage is still being read.
    vi.advanceTimersByTime(750);
    await tab.flush();
    expect(await storedIds(tab)).toEqual([a.id]);

    storage.answer();
    expect(await booting).toMatchObject({ ok: true, value: { id: a.id, name: "Alpha" } });
    await tab.flush();
    expect(await storedIds(tab)).toEqual([a.id]);
  });

  test("a first visit stores the untitled document once the visitor edits it, not for a prediction", async () => {
    doc.load(makeProject({ id: "untitled", name: "Untitled", recipe }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const store = testPersistence();
    await until(() => editLockState().state === "held", "the untitled document's lock");
    recordPrediction();
    vi.advanceTimersByTime(750);
    await store.flush();
    expect(await storedIds(store)).toEqual([]);
    expect(saveStatus()).toEqual({ state: "saved", text: "Saved" });

    rename("My own");
    expect(saveStatus()).toEqual({ state: "saving", text: "Saving…" });
    const saved = nextStatus(store, "saved");
    vi.advanceTimersByTime(750);
    await saved;
    const stored = await store.listProjects();
    expect(stored.map((p) => p.name)).toEqual(["My own"]);
    // The prediction recorded before the edit is kept with it.
    expect(stored[0]?.project.predicted).toEqual([{ chainId: 11155111, address: address(3) }]);
  });

  test("an untitled document with only a prediction isn't written when another project replaces it", async () => {
    doc.load(makeProject({ id: "untitled", name: "Untitled", recipe }));
    const store = testPersistence();
    await until(() => editLockState().state === "held", "the untitled document's lock");
    recordPrediction();
    const linked = makeProject({ id: "linked", name: "GovernedVault (shared)", recipe });
    doc.load(linked);
    await until(() => JSON.stringify(editLockState()) === JSON.stringify({ state: "held", projectId: "linked" }), "the new project's lock");
    await store.flush();
    expect(await storedIds(store)).toEqual(["linked"]);
  });
});

describe("viewports and storage", () => {
  test("a viewport is saved and loaded per project, outside the document", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const store = testPersistence();
    const project = await created();
    saveViewport(project.id, { x: 10, y: -20, zoom: 1.5 });
    saveViewport("other", { x: 1, y: 2, zoom: 0.5 });
    expect(await loadViewport(project.id)).toEqual({ x: 10, y: -20, zoom: 1.5 });
    vi.advanceTimersByTime(750);

    const reader = testPersistence({ dbName: store.dbName, doc: fakeDoc(project), provide: false, start: false });
    await until(async () => (await reader.projects.loadViewport(project.id)) !== null, "the viewport to be written");
    expect(await reader.projects.loadViewport(project.id)).toEqual({ x: 10, y: -20, zoom: 1.5 });
    expect(await reader.projects.loadViewport("other")).toEqual({ x: 1, y: 2, zoom: 0.5 });
    expect(await reader.projects.loadViewport("never")).toBeNull();

    const db = await openStudioDb(store.dbName, { onVersionChange: () => {} });
    onCleanup(() => db.close());
    expect(await db.get("meta", META.viewport(project.id))).toEqual({ x: 10, y: -20, zoom: 1.5 });
    expect(JSON.stringify(await db.get("projects", project.id))).not.toContain("zoom");
  });

  test("the first explicit save asks for persistent storage; Safari gets its tip once", async () => {
    const persist = vi.fn(async () => true);
    const persisted = vi.fn(async () => true);
    const store = testPersistence({
      storage: { persist, persisted },
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    });
    expect(await store.markExplicitSave()).toEqual({ first: true, persisted: true, safariTip: true });
    expect(await store.markExplicitSave()).toEqual({ first: false, persisted: true, safariTip: false });
    expect(persist).toHaveBeenCalledTimes(1);

    const chrome = testPersistence({
      storage: { persist: async () => false },
      userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
    });
    expect(await chrome.markExplicitSave()).toEqual({ first: true, persisted: false, safariTip: false });
  });
});

describe("data that must never be lost", () => {
  test("the boot's untitled document gets its own id, so a stored project is never overwritten", async () => {
    doc.load(makeProject({ id: "untitled", name: "Untitled", recipe }));
    const first = testPersistence();
    const id = doc.get().id;
    expect(id).not.toBe("untitled");
    rename("My work");
    await first.flush();
    expect(await storedName(first, id)).toBe("My work");
    // An older build stored a project under the fixed id.
    const db = await openStudioDb(first.dbName, { onVersionChange: () => {} });
    await db.put("projects", { id: "untitled", savedAt: 0, project: makeProject({ id: "untitled", name: "Old work", recipe }) });
    db.close();
    await first.close();

    // Reload: a new tab boots on its own untitled document and lands in the stored work.
    const tabDoc = fakeDoc(makeProject({ id: "untitled", name: "Untitled", recipe }));
    const tab = testPersistence({ dbName: first.dbName, doc: tabDoc, start: false, page: null });
    expect(await bootPersistence()).toMatchObject({ ok: true, value: { id, name: "My work" } });
    expect(tabDoc.get().name).toBe("My work");
    // Opening the old "untitled" record reads it; it isn't mistaken for the boot document.
    expect(await tab.projects.openProject("untitled")).toMatchObject({ ok: true, value: { name: "Old work" } });
    expect(tabDoc.get().name).toBe("Old work");
    expect(await storedName(tab, "untitled")).toBe("Old work");
  });

  test("every fresh boot draws its own salt entropy and takes the deploy path from Settings", async () => {
    const zeros: `0x${string}` = `0x${"00".repeat(11)}`;
    const previousPath = settings.get().defaultPath;
    onCleanup(() => settings.set({ defaultPath: previousPath }));
    settings.set({ defaultPath: "createx" });
    const boot = () => makeProject({
      id: "untitled", name: "Untitled", recipe, deploy: { path: "factory", entropy: zeros, scope: "every-chain" },
    });
    const firstDoc = fakeDoc(boot());
    const secondDoc = fakeDoc(boot());
    testPersistence({ doc: firstDoc, provide: false, page: null });
    testPersistence({ doc: secondDoc, provide: false, page: null });

    const first = firstDoc.get().deploy;
    const second = secondDoc.get().deploy;
    expect(first.entropy).toMatch(/^0x[0-9a-f]{22}$/);
    expect(first.entropy).not.toBe(zeros);
    expect(second.entropy).not.toBe(zeros);
    expect(second.entropy).not.toBe(first.entropy);
    expect(first.path).toBe("createx");
    expect(second.path).toBe("createx");
    expect(first.scope).toBe("every-chain");
  });

  test("a second fresh tab lands read-only in the first tab's work, not in an empty document", async () => {
    doc.load(makeProject({ id: "untitled", name: "Untitled", recipe }));
    const first = testPersistence();
    rename("My work");
    await first.flush();

    const tabDoc = fakeDoc(makeProject({ id: "untitled", name: "Untitled", recipe }));
    const tab = testPersistence({ dbName: first.dbName, doc: tabDoc, page: null, provide: false });
    expect(await tab.openLastProject()).toMatchObject({ ok: true, value: { name: "My work" } });
    expect(tabDoc.get().name).toBe("My work");
    expect(tab.editLock()).toEqual({ state: "elsewhere", projectId: doc.get().id });
  });

  test("a project trashed in another tab isn't written back by the tab editing it", async () => {
    const first = testPersistence({ quietMs: 60_000 });
    const project = await created("Vault");
    rename("Pending edit");
    const other = testPersistence({ dbName: first.dbName, doc: fakeDoc(makeProject({ id: "untitled" })), provide: false, page: null });
    expect(await other.deleteProject(project.id)).toMatchObject({ ok: true });
    await first.flush();
    expect(await first.listProjects()).toEqual([]);
    expect((await first.listTrash()).map((t) => t.id)).toEqual([project.id]);
    await until(() => saveStatus().state === "not-saved", "the editing tab to stop saving");
    expect(saveStatus()).toEqual({
      state: "not-saved", text: "Not saved", detail: "This project is in Recently deleted. Restore it to keep saving.",
    });

    // Restored in the other tab: the editing tab saves again, its newer edit included.
    expect(await other.restoreProject(project.id)).toMatchObject({ ok: true });
    await until(() => saveStatus().state !== "not-saved", "the editing tab to save again");
    await first.flush();
    expect(await storedName(first, project.id)).toBe("Pending edit");
  });

  test("clear data in another tab stops the editing tab from writing its project back", async () => {
    const first = testPersistence({ quietMs: 60_000 });
    await created("Vault");
    rename("Pending edit");
    const other = testPersistence({ dbName: first.dbName, doc: fakeDoc(makeProject({ id: "untitled" })), provide: false, page: null });
    await other.clearData();
    await first.flush();
    expect(await first.listProjects()).toEqual([]);
    await until(() => saveStatus().state === "not-saved", "the editing tab to stop saving");
    expect(saveStatus()).toMatchObject({ state: "not-saved", text: "Not saved" });
  });

  test("the holder saves edits made during the handover's save before letting go", async () => {
    const first = testPersistence({ quietMs: 60_000 });
    const project = await created("Vault");
    const { tab: second } = await otherTab(first, project);
    rename("Before the handover");
    const transaction = IDBDatabase.prototype.transaction;
    let edited = false;
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
      this: IDBDatabase, ...args: Parameters<IDBDatabase["transaction"]>
    ) {
      const tx = transaction.apply(this, args);
      const stores = Array.isArray(args[0]) ? args[0] : [args[0]];
      if (!edited && stores.includes("trash") && doc.get().name === "Before the handover") {
        edited = true;
        queueMicrotask(() => rename("During the handover's save"));
      }
      return tx;
    });
    expect(await second.takeOverEditing()).toMatchObject({ ok: true, value: { name: "During the handover's save" } });
    expect(edited).toBe(true);
  });

  test("a holder that answers isn't stolen from, however long its save takes", async () => {
    const prefix = `lattice-studio-test-ack-${crypto.randomUUID()}`;
    const events: string[] = [];
    const channelA = openChannel(`${prefix}:tabs`);
    const channelB = openChannel(`${prefix}:tabs`);
    const holder = createEditLock({
      prefix, locks: navigator.locks, channel: channelA, peerId: "a", onChange: () => {}, onError: () => {},
      beforeHandover: () => new Promise<void>((resolve) => realTimeout(() => {
        events.push("holder saved");
        resolve();
      }, 200)),
    });
    const taker = createEditLock({
      prefix, locks: navigator.locks, channel: channelB, peerId: "b", onChange: () => {}, onError: () => {},
      beforeHandover: async () => {}, stealAfter: 50,
    });
    onCleanup(() => {
      holder.dispose();
      taker.dispose();
      channelA.close();
      channelB.close();
    });
    expect(await holder.claim("p")).toBe(true);
    expect(await taker.claim("p")).toBe(false);
    expect(await taker.takeOver("p")).toEqual({ ok: true, value: undefined });
    events.push("taker holds");
    expect(events).toEqual(["holder saved", "taker holds"]);
    expect(holder.state()).toEqual({ state: "handed-over", projectId: "p" });
  });

  test("a browser that refuses Web Locks still saves, and says so", async () => {
    const locks = {
      request: () => Promise.reject(new TypeError("Web Locks are disabled.")),
      query: async () => ({ held: [], pending: [] }),
    } as unknown as LockManager;
    const store = testPersistence({ locks });
    const project = await created("Vault");
    expect(editLockState()).toEqual({ state: "held", projectId: project.id });
    rename("Saved anyway");
    await store.flush();
    expect(await storedName(store, project.id)).toBe("Saved anyway");
    expect(bufferedServices().log.some((l) => l.text.startsWith("Couldn't coordinate editing with other tabs."))).toBe(true);
  });
});

describe("handover and upgrade edge cases", () => {
  test("a holder whose saves keep failing keeps editing and says why; the taker is told", async () => {
    const first = testPersistence({ quietMs: 60_000 });
    const project = await created("Vault");
    const { tab: second } = await otherTab(first, project);
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "projects") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return put.apply(this, args);
    });
    rename("Can't be saved");
    expect(await second.takeOverEditing()).toEqual({
      ok: false,
      error: "The other tab kept editing: its changes aren't saved yet. Not saved: browser storage is full.",
    });
    expect(first.editLock()).toEqual({ state: "held", projectId: project.id });
    expect(second.editLock()).toEqual({ state: "elsewhere", projectId: project.id });
    expect(saveStatus()).toEqual({
      state: "not-saved", text: "Not saved: browser storage is full", action: { id: "project.saveCopy" },
      detail: "Another tab asked to take over editing. This tab kept it because its changes aren't saved. Not saved: browser storage is full.",
    });
    expect(await storedName(first, project.id)).toBe("Vault");
  });

  test("a holder that answered but never finishes saving: the taker gives up after a while and says so", async () => {
    const prefix = `lattice-studio-test-hung-${crypto.randomUUID()}`;
    const channelA = openChannel(`${prefix}:tabs`);
    const channelB = openChannel(`${prefix}:tabs`);
    const holder = createEditLock({
      prefix, locks: navigator.locks, channel: channelA, peerId: "a", onChange: () => {}, onError: () => {},
      beforeHandover: () => new Promise<void>(() => {}),
    });
    const taker = createEditLock({
      prefix, locks: navigator.locks, channel: channelB, peerId: "b", onChange: () => {}, onError: () => {},
      beforeHandover: async () => {}, stealAfter: 50, ackedPatience: 150,
    });
    onCleanup(() => {
      holder.dispose();
      taker.dispose();
      channelA.close();
      channelB.close();
    });
    expect(await holder.claim("p")).toBe(true);
    expect(await taker.claim("p")).toBe(false);
    expect(await taker.takeOver("p")).toEqual({ ok: false, error: STILL_SAVING });
    expect(holder.state()).toEqual({ state: "held", projectId: "p" });
    expect(taker.state()).toEqual({ state: "elsewhere", projectId: "p" });
  });

  test("an edit that can't be saved before an upgrade keeps Reload hidden and offers Save a copy…", async () => {
    const store = testPersistence({ quietMs: 60_000 });
    await created();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (
      this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>
    ) {
      if (this.name === "projects") throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      return put.apply(this, args);
    });
    rename("Unsaved");
    const upgraded = await openDB(store.dbName, 2);
    onCleanup(() => upgraded.close());
    await until(() => saveStatus().detail === "A new version of Studio is ready", "the upgrade to close storage");
    expect(saveStatus()).toEqual({
      state: "not-saved", text: "Not saved", detail: "A new version of Studio is ready", action: { id: "project.saveCopy" },
    });
    expect(bufferedServices().banners.has("persist.updated")).toBe(false);
  });

  test("a database deleted by another tab is never recreated to hold a record", async () => {
    const store = testPersistence();
    const project = await created();
    await deleteDB(store.dbName);
    await until(() => saveStatus().state !== "saving", "the tab to close storage");
    const error = await putDeployment(deployment(project.id, 9)).then(() => null, (e: Error) => e.message);
    expect(error).toBe("Studio's storage was deleted in another tab. Reload to continue. This deployment record wasn't saved.");
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(store.dbName);
  });

  test("expiry when storage opens says what it kept and tells every listener", async () => {
    const clock = fakeClock({ at: "2026-09-23T12:00:00Z" });
    const earlier = testPersistence();
    const gone = await created("Gone");
    await putDeployment(deployment(gone.id, 1));
    await putDeployment(deployment(gone.id, 2));
    const keep = await created("Keep");
    await earlier.deleteProject(gone.id);
    // Another project now holds one of the addresses.
    await putDeployment(deployment(keep.id, 2));
    await earlier.close();

    clock.advance(30 * DAY);
    const store = testPersistence({ dbName: earlier.dbName, start: false });
    const heard: string[] = [];
    onCleanup(store.deployments.subscribe((id) => heard.push(id)));
    expect(await store.listProjects()).toMatchObject([{ id: keep.id }]);
    expect(heard).toContain(gone.id);
    expect(await listDeployments(gone.id)).toEqual([deployment(gone.id, 1)]);
    expect(await listDeployments(keep.id)).toEqual([deployment(keep.id, 2)]);
    expect(bufferedServices().log.at(-1)).toMatchObject({
      tag: "Note",
      text: "1 deployment record from projects deleted 30 days ago matches an address another record holds now. The stored record was kept.",
    });
  });
});

describe("edge cases from the last review", () => {
  /** Two edit locks on one channel name, `a` holding "p" and saving for `saveMs` before it lets go. */
  function lockPair(saveMs: number, holderChannel?: (channel: Channel) => Channel) {
    const prefix = `lattice-studio-test-withdraw-${crypto.randomUUID()}`;
    const channelA = openChannel(`${prefix}:tabs`);
    const channelB = openChannel(`${prefix}:tabs`);
    const holderStates: string[] = [];
    const holder = createEditLock({
      prefix, locks: navigator.locks, channel: holderChannel ? holderChannel(channelA) : channelA, peerId: "a",
      onChange: (state) => holderStates.push(state.state), onError: () => {},
      beforeHandover: () => new Promise<void>((resolve) => realTimeout(resolve, saveMs)),
    });
    const taker = createEditLock({
      prefix, locks: navigator.locks, channel: channelB, peerId: "b", onChange: () => {}, onError: () => {},
      beforeHandover: async () => {}, stealAfter: 50, ackedPatience: 100,
    });
    onCleanup(() => {
      holder.dispose();
      taker.dispose();
      channelA.close();
      channelB.close();
    });
    const lockName = `${prefix}:edit:p`;
    const held = async () => (await navigator.locks.query()).held?.filter((l) => l.name === lockName) ?? [];
    return { holder, taker, holderStates, held, lockName };
  }

  test("a taker that gave up withdraws its request: the holder keeps editing once it has saved", async () => {
    const { holder, taker, held } = lockPair(300);
    expect(await holder.claim("p")).toBe(true);
    expect(await taker.claim("p")).toBe(false);
    expect(await taker.takeOver("p")).toEqual({ ok: false, error: STILL_SAVING });
    // The holder's save finishes after the taker gave up.
    await new Promise((resolve) => realTimeout(resolve, 400));
    expect(holder.state()).toEqual({ state: "held", projectId: "p" });
    expect(taker.state()).toEqual({ state: "elsewhere", projectId: "p" });
    expect(await held()).toHaveLength(1);
    expect(await taker.claim("p")).toBe(false);
  });

  test("a withdrawal that arrives after the holder let go gets the lock back to the holder", async () => {
    // The holder hears the withdrawal late, after its save finished and it let go.
    const late = (channel: Channel): Channel => ({
      ...channel,
      subscribe: (listener) => channel.subscribe((m) => {
        if (m.kind === "lock-withdraw") realTimeout(() => listener(m), 300);
        else listener(m);
      }),
    });
    const { holder, taker, holderStates, held } = lockPair(200, late);
    expect(await holder.claim("p")).toBe(true);
    expect(await taker.claim("p")).toBe(false);
    expect(await taker.takeOver("p")).toEqual({ ok: false, error: STILL_SAVING });
    await until(() => holderStates.includes("handed-over"), "the holder to let go");
    await until(() => holder.state().state === "held", "the holder to take the lock back");
    expect(taker.state()).toEqual({ state: "elsewhere", projectId: "p" });
    expect(await held()).toHaveLength(1);
  });

  test("take back editing before a late withdrawal arrives still ends with this tab editing", async () => {
    // The holder's withdrawals wait until the test delivers them.
    const held: { listener: (m: ChannelMessage) => void; message: ChannelMessage }[] = [];
    const captured = (channel: Channel): Channel => ({
      ...channel,
      subscribe: (listener) => channel.subscribe((m) => {
        if (m.kind === "lock-withdraw") held.push({ listener, message: m });
        else listener(m);
      }),
    });
    const { holder, taker, holderStates, held: holders, lockName } = lockPair(200, captured);
    expect(await holder.claim("p")).toBe(true);
    expect(await taker.claim("p")).toBe(false);
    expect(await taker.takeOver("p")).toEqual({ ok: false, error: STILL_SAVING });
    await until(() => holderStates.includes("handed-over") && held.length > 0, "the holder to let go");

    // Something else holds the lock for a moment, so Take back editing waits for it.
    let release: () => void = () => {};
    onCleanup(() => release());
    await new Promise<void>((granted) => {
      void navigator.locks.request(lockName, () => new Promise<void>((r) => {
        release = r;
        granted();
      }));
    });
    const back = holder.takeOver("p");
    for (const { listener, message } of held.splice(0)) listener(message);
    await new Promise((resolve) => realTimeout(resolve, 50));
    release();
    expect(await back).toEqual({ ok: true, value: undefined });
    expect(holder.state()).toEqual({ state: "held", projectId: "p" });
    expect(await holders()).toHaveLength(1);
  });

  test("without indexedDB.databases(), a database deleted after an upgrade still isn't recreated for a record", async () => {
    const databases = Object.getOwnPropertyDescriptor(IDBFactory.prototype, "databases");
    const restore = () => {
      if (databases) Object.defineProperty(IDBFactory.prototype, "databases", databases);
    };
    onCleanup(restore);
    const store = testPersistence();
    const project = await created();
    const upgraded = await openDB(store.dbName, 2);
    await until(() => bufferedServices().banners.has("persist.updated"), "the reload banner");
    upgraded.close();
    await deleteDB(store.dbName);
    // Firefox before 126 has no indexedDB.databases().
    Object.defineProperty(IDBFactory.prototype, "databases", { value: undefined, configurable: true });
    const error = await putDeployment(deployment(project.id, 9)).then(() => null, (e: Error) => e.message);
    restore();
    expect(error).toBe("Studio's storage was deleted in another tab. Reload to continue. This deployment record wasn't saved.");
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(store.dbName);
  });

  test("after an upgrade, a database deleted since isn't recreated to hold a record", async () => {
    const store = testPersistence();
    const project = await created();
    const upgraded = await openDB(store.dbName, 2);
    await until(() => bufferedServices().banners.has("persist.updated"), "the reload banner");
    upgraded.close();
    await deleteDB(store.dbName);
    const error = await putDeployment(deployment(project.id, 9)).then(() => null, (e: Error) => e.message);
    expect(error).toBe("Studio's storage was deleted in another tab. Reload to continue. This deployment record wasn't saved.");
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(store.dbName);
  });

  test("after an upgrade that dropped the deployments store, a record isn't saved and it says why", async () => {
    const store = testPersistence();
    const project = await created();
    const upgraded = await openDB(store.dbName, 2, {
      upgrade(db) {
        db.deleteObjectStore("deployments");
      },
    });
    onCleanup(() => upgraded.close());
    await until(() => bufferedServices().banners.has("persist.updated"), "the reload banner");
    const error = await putDeployment(deployment(project.id, 9)).then(() => null, (e: Error) => e.message);
    expect(error).toBe("A new version of Studio is ready. Reload to save deployment records. This deployment record wasn't saved.");
    expect(Array.from(upgraded.objectStoreNames)).not.toContain("deployments");
  });

  test("expiry that fails says so in the console", async () => {
    const store = testPersistence({ start: false });
    const transaction = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
      this: IDBDatabase, ...args: Parameters<IDBDatabase["transaction"]>
    ) {
      const stores = Array.isArray(args[0]) ? args[0] : [args[0]];
      if (stores.join() === "trash,meta,deployments") throw new DOMException("The disk is busy.", "UnknownError");
      return transaction.apply(this, args);
    });
    // Storage opening expires Recently deleted, and so does listing it: said once.
    expect(await store.listTrash()).toEqual([]);
    expect(await store.listTrash()).toEqual([]);
    expect(bufferedServices().log.filter((l) => l.text.startsWith("Couldn't empty"))).toEqual([
      expect.objectContaining({ tag: "Error", text: "Couldn't empty Recently deleted. The disk is busy." }),
    ]);
  });

  /** A stored project "Alpha" as the last one, and a fresh tab on the app's document, not started yet. */
  async function returning(): Promise<Project> {
    const earlier = testPersistence();
    const alpha = await created("Alpha");
    await earlier.close();
    doc.load(makeProject({ id: "untitled", name: "Untitled", recipe }));
    testPersistence({ dbName: earlier.dbName, start: false });
    return alpha;
  }

  /** Runs `during` once, while the boot reads which project was last. */
  function whileBootReads(during: () => void): void {
    const getKey = IDBObjectStore.prototype.getKey;
    let done = false;
    vi.spyOn(IDBObjectStore.prototype, "getKey").mockImplementation(function (
      this: IDBObjectStore, ...args: Parameters<IDBObjectStore["getKey"]>
    ) {
      if (!done) {
        done = true;
        queueMicrotask(during);
      }
      return getKey.apply(this, args);
    });
  }

  test("an edit made while the boot reads storage keeps the visitor where they are", async () => {
    await returning();
    whileBootReads(() => rename("Typed during boot"));
    expect(await bootPersistence()).toBeNull();
    expect(doc.get().name).toBe("Typed during boot");
  });

  test("a prediction recorded while the boot reads storage doesn't keep the visitor from their last project", async () => {
    const alpha = await returning();
    whileBootReads(() => doc.record("Recorded the predicted address", (p) => ({
      project: { ...p, predicted: [{ chainId: 11155111, address: address(3) }] }, changed: true,
      summary: "Recorded the predicted address",
    })));
    expect(await bootPersistence()).toMatchObject({ ok: true, value: { id: alpha.id, name: "Alpha" } });
    // The untitled document it left isn't saved as a project.
    expect((await (await persistence()).listProjects()).map((p) => p.name)).toEqual(["Alpha"]);
  });

  function at(hash: string): void {
    const before = `${location.pathname}${location.search}${location.hash}`;
    history.replaceState(history.state, "", `${location.pathname}${location.search}${hash}`);
    onCleanup(() => history.replaceState(history.state, "", before));
  }

  test("a share link or #open= opens its own project, not the last one", async () => {
    await returning();
    at("#s=1.abc");
    expect(await bootPersistence()).toBeNull();
    expect(doc.get().name).toBe("Untitled");

    at("#open=eip155:11155111:0x0000000000000000000000000000000000000001");
    expect(await bootPersistence()).toBeNull();
    expect(doc.get().name).toBe("Untitled");
  });

  test("another hash route (#/settings, as an IPFS build routes) still lands in the last project", async () => {
    const alpha = await returning();
    at("#/settings");
    expect(await bootPersistence()).toMatchObject({ ok: true, value: { id: alpha.id, name: "Alpha" } });
    expect(doc.get()).toMatchObject({ id: alpha.id, name: "Alpha" });
  });
});

describe("deleting a deployment record (Discard proposal, spec L580)", () => {
  test("the contracts' deleteDeployment deletes the record instead of marking it failed, and both tabs hear it", async () => {
    const first = testPersistence();
    const project = await created("Vault");
    const { tab: second } = await otherTab(first, project);
    const proposed = deployment(project.id, 7, { status: "proposed" });
    const kept = deployment(project.id, 8);
    const heardThere: string[] = [];
    onCleanup(second.deployments.subscribe((id) => heardThere.push(id)));
    await putDeployment(proposed);
    await putDeployment(kept);
    await until(() => heardThere.length === 2, "the other tab to hear both writes");
    heardThere.length = 0;

    const heardHere: string[] = [];
    onCleanup(subscribeDeployments((id) => heardHere.push(id)));
    // Whatever case the address arrives in.
    await deleteDeployment({ ...proposed, address: proposed.address.toLowerCase() as `0x${string}` });

    expect(await listDeployments(project.id)).toEqual([kept]);
    expect(await second.deployments.listDeployments(project.id)).toEqual([kept]);
    expect(heardHere).toEqual([project.id]);
    await until(() => heardThere.length > 0, "the other tab to hear the delete");
    expect(heardThere).toEqual([project.id]);
  });

  test("a record that isn't stored: nothing changes and nobody is told", async () => {
    testPersistence();
    const project = await created();
    const kept = deployment(project.id, 8);
    await putDeployment(kept);
    const heard: string[] = [];
    onCleanup(subscribeDeployments((id) => heard.push(id)));
    await deleteDeployment(deployment(project.id, 9));
    expect(await listDeployments(project.id)).toEqual([kept]);
    expect(heard).toEqual([]);
  });

  test("after a newer Studio upgraded the database, a record is still deleted", async () => {
    const store = testPersistence();
    const project = await created();
    const proposed = deployment(project.id, 7, { status: "proposed" });
    await putDeployment(proposed);
    const upgraded = await openDB(store.dbName, 2);
    onCleanup(() => upgraded.close());
    await until(() => bufferedServices().banners.has("persist.updated"), "the reload banner");
    await deleteDeployment(proposed);
    expect(await upgraded.getAll("deployments")).toEqual([]);
  });

  test("after another tab deleted the database, deleting a record neither fails nor recreates the database", async () => {
    const store = testPersistence();
    const project = await created();
    await putDeployment(deployment(project.id, 7, { status: "proposed" }));
    const heard: string[] = [];
    onCleanup(subscribeDeployments((id) => heard.push(id)));
    // Clear data in another tab: the delete waits for this tab to let go, then removes everything.
    await deleteDB(store.dbName);
    await deleteDeployment(deployment(project.id, 7, { status: "proposed" }));
    expect(heard).toEqual([]);
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(store.dbName);
  });

  test("after an upgrade, then the database deleted, deleting a record neither fails nor recreates the database", async () => {
    const store = testPersistence();
    const project = await created();
    const proposed = deployment(project.id, 7, { status: "proposed" });
    await putDeployment(proposed);
    const upgraded = await openDB(store.dbName, 2);
    await until(() => bufferedServices().banners.has("persist.updated"), "the reload banner");
    upgraded.close();
    await deleteDB(store.dbName);
    await deleteDeployment(proposed);
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain(store.dbName);
  });

  test("after an upgrade that dropped the deployments store, a record isn't deleted and it says why", async () => {
    const store = testPersistence();
    const project = await created();
    const upgraded = await openDB(store.dbName, 2, {
      upgrade(db) {
        db.deleteObjectStore("deployments");
      },
    });
    onCleanup(() => upgraded.close());
    await until(() => bufferedServices().banners.has("persist.updated"), "the reload banner");
    const error = await deleteDeployment(deployment(project.id, 9)).then(() => null, (e: Error) => e.message);
    expect(error).toBe("A new version of Studio is ready. Reload to delete deployment records. This deployment record wasn't deleted.");
  });
});
