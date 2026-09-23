/**
 * Persistence against the browser's real IndexedDB, Web Locks and BroadcastChannel. Each test has its own
 * database (`testPersistence`); two instances on one database play two tabs.
 */
import { toChecksum, type Deployment, type Project, type Recipe } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { openDB } from "idb";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createProject, doc, listDeployments, loadViewport, openProject, putDeployment, saveStatus, saveViewport,
  subscribeDeployments, type SaveStatus,
} from "@/contracts";
import { bufferedServices, fakeClock, onCleanup } from "../../test/harness";
import { META, openStudioDb } from "./db";
import { bootPersistence, editLockState, subscribeEditLock } from "./index";
import type { Persistence } from "./persistence";
import { fakeDoc, testPersistence } from "./testing";

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

const recipe: Recipe = makeRecipe();

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
    window.dispatchEvent(new PageTransitionEvent("pagehide"));
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
    expect(saveStatus()).toEqual({ state: "not-saved", text: "Not saved: browser storage is full" });
    expect(bufferedServices().banners.get("persist.storage-full")).toEqual({
      text: "Not saved: browser storage is full", tone: "error", actions: [{ id: "project.saveCopy" }],
    });
    expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Error", text: "Not saved: browser storage is full." });
    expect(await storedName(store, project.id)).toBe("Vault");

    spy.mockRestore();
    rename("Fits again");
    await store.flush();
    expect(saveStatus()).toEqual({ state: "saved", text: "Saved" });
    expect(bufferedServices().banners.has("persist.storage-full")).toBe(false);
    expect(await storedName(store, project.id)).toBe("Fits again");
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

    const other = testPersistence({ dbName: store.dbName, doc: fakeDoc(makeProject({ id: "blank" })), provide: false, page: null });
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

  test("export all includes Recently deleted, and clear data counts what it would delete", async () => {
    const store = testPersistence();
    const a = await created("Alpha");
    await putDeployment(deployment(a.id, 1));
    await putDeployment(deployment(a.id, 2, { status: "failed" }));
    const b = await created("Beta");
    await putDeployment(deployment(b.id, 3));
    await store.deleteProject(a.id);

    const files = await store.exportAll();
    expect(files.map((f) => f.filename).sort()).toEqual(["alpha.lattice.json", "beta.lattice.json"]);
    const alpha = JSON.parse(files.find((f) => f.filename === "alpha.lattice.json")?.text ?? "{}") as {
      deployments: Deployment[];
    };
    expect(alpha.deployments).toHaveLength(2);

    expect(await store.clearDataCounts()).toEqual({ projects: 1, trashed: 1, records: 3, deployed: 2 });
    await store.clearData();
    expect(await store.clearDataCounts()).toEqual({ projects: 0, trashed: 0, records: 0, deployed: 0 });
    rename("Not resurrected");
    await store.flush();
    expect(await store.listProjects()).toEqual([]);
  });
});

describe("Recently deleted", () => {
  test("keeps a project and its records for 30 days, then deletes them", async () => {
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
    expect(await store.restoreProject(gone.id)).toEqual({ ok: false, error: "This project isn't in Recently deleted." });
  });

  test("restore brings the records back; delete for good counts what goes", async () => {
    const store = testPersistence();
    const a = await created("Alpha");
    await putDeployment(deployment(a.id, 1));
    await created("Beta");
    await store.deleteProject(a.id);
    const restored = await store.restoreProject(a.id);
    expect(restored).toMatchObject({ ok: true, value: { id: a.id, name: "Alpha" } });
    expect(await listDeployments(a.id)).toEqual([deployment(a.id, 1)]);

    await store.deleteProject(a.id);
    expect(await store.deleteForGood(a.id)).toEqual({ ok: true, value: { records: 1, deployed: 1 } });
    expect(await store.listTrash()).toEqual([]);
    expect(await store.clearDataCounts()).toMatchObject({ records: 0 });
  });

  test("deleting the open project doesn't write it back", async () => {
    const store = testPersistence();
    const a = await created("Alpha");
    rename("Alpha edited");
    expect(await store.deleteProject(a.id)).toMatchObject({ ok: true });
    rename("After delete");
    await store.flush();
    expect(await store.listProjects()).toEqual([]);
    expect((await store.listTrash())[0]?.name).toBe("Alpha edited");
  });
});

describe("two tabs", () => {
  test("the second tab opens read-only; take over flushes the first tab's pending save and hands the lock over", async () => {
    // The first tab waits a minute before autosaving, so only the handover can have written its edit.
    const first = testPersistence({ quietMs: 60_000 });
    const project = await created("Vault");
    const secondDoc = fakeDoc(project);
    const second = testPersistence({ dbName: first.dbName, doc: secondDoc, provide: false, page: null });
    await until(() => second.editLock().state === "elsewhere", "the second tab to open read-only");
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

    const tab = testPersistence({ dbName: store.dbName, doc: fakeDoc(project), page: null, stealAfter: 50 });
    await until(() => tab.editLock().state === "elsewhere", "the tab to open read-only");
    expect(await tab.takeOverEditing()).toMatchObject({ ok: true, value: { id: project.id } });
    expect(tab.editLock()).toEqual({ state: "held", projectId: project.id });
    expect(await frozenLost).toBe("AbortError");
  });

  test("a demoted tab still records deployments, and the other tab hears it", async () => {
    const first = testPersistence();
    const project = await created("Vault");
    const second = testPersistence({ dbName: first.dbName, doc: fakeDoc(project), provide: false, page: null });
    await until(() => second.editLock().state === "elsewhere", "the second tab to open read-only");
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
    await created();
    const upgraded = await openDB(store.dbName, 2);
    onCleanup(() => upgraded.close());
    expect(bufferedServices().banners.get("persist.updated")).toEqual({
      text: "Studio was updated in another tab. Reload to continue.", tone: "warning", actions: [{ id: "app.reload" }],
    });
    await until(() => saveStatus().state === "not-saved", "the status to say not saved");
    expect(saveStatus()).toEqual({
      state: "not-saved", text: "Not saved", detail: "Studio was updated in another tab. Reload to continue.",
    });
  });
});

describe("boot", () => {
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
