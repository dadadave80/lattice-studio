/**
 * S7b's commands against real IndexedDB (`testPersistence`) and a real drop event: New project's reset,
 * the save-and-reopen round trip through the File System Access API, dropping a bad file, delete with
 * Undo, and the unknown-fields line (spec L289).
 */
import { toChecksum, type Deployment } from "@lattice-studio/core";
import { makeRecipe } from "@lattice-studio/core/testing";
import { afterEach, describe, expect, test } from "vitest";
import {
  createProject, doc, loadViewport, putDeployment, runCommand, saveViewport, session, setCatalogStatus,
} from "@/contracts";
import { testPersistence } from "@/persist/testing";
import { bufferedServices, fixtureCatalog, onCleanup } from "../../test/harness";
import { installFileDrop } from "./file-drop";
import type { FsFileHandle, FsWindow } from "./fs-types";

const catalog = fixtureCatalog();

function readyCatalog(): void {
  setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
  onCleanup(() => setCatalogStatus({ status: "loading" }));
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

async function until(check: () => boolean | Promise<boolean>, what = "condition"): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

afterEach(() => {
  const w = window as unknown as FsWindow;
  delete w.showSaveFilePicker;
  delete w.showOpenFilePicker;
});

describe("project.new", () => {
  test("resets modes, selection and viewport, and never asks (PA #5, #16)", async () => {
    readyCatalog();
    const opened = await createProject(makeRecipe({}, catalog), "Vault");
    if (!opened.ok) throw new Error(opened.error);
    const oldId = opened.value.id;
    session.set({
      selection: ["ERC20"],
      modes: { initOrder: true, moveTo: true, rows: "ERC20" },
    });
    saveViewport(oldId, { x: 10, y: 20, zoom: 1.5 });

    const result = await runCommand({ id: "project.new" }, "api");
    expect(result.ok).toBe(true);

    expect(doc.get().id).not.toBe(oldId);
    expect(doc.get().recipe.facets).toEqual([]);
    expect(session.get().selection).toEqual([]);
    expect(session.get().focus).toBeNull();
    expect(session.get().modes).toEqual({ initOrder: false, moveTo: false, rows: null });
    expect(await loadViewport(doc.get().id)).toBeNull();
    expect(bufferedServices().log.at(-1)?.text).toBe("New project.");
  });
});

describe("save and reopen", () => {
  test("⌘S with no linked file links one on Save a copy…, then reuses it; the same file reopens as a new project", async () => {
    readyCatalog();
    testPersistence();
    const opened = await createProject(makeRecipe({ facets: [] }, catalog), "Vault");
    if (!opened.ok) throw new Error(opened.error);
    const project = opened.value;

    let written = "";
    const handle: FsFileHandle = {
      name: "vault.lattice.json",
      createWritable: async () => ({
        write: async (text: string) => {
          written = text;
        },
        close: async () => {},
      }),
    };
    (window as unknown as FsWindow).showSaveFilePicker = async () => handle;

    const { saveCopy, saveOrPrompt } = await import("./actions");
    const first = await saveCopy(project, "vault.lattice.json");
    expect(first.ok).toBe(true);
    expect(written).toContain('"Vault"');
    const firstWrite = written;
    // spec L733: a saved file is a toast (no final period, unlike the console line).
    expect(bufferedServices().toast.at(-1)).toEqual({ text: "Saved to vault.lattice.json" });

    // ⌘S again: writes the linked handle directly, without reopening Save a copy.
    written = "";
    let openedDialog = false;
    await saveOrPrompt(doc.get(), () => {
      openedDialog = true;
    });
    expect(openedDialog).toBe(false);
    expect(written).toContain('"Vault"');
    expect(written).toBe(firstWrite);
    expect(bufferedServices().toast.at(-1)).toEqual({ text: "Saved to vault.lattice.json" });

    // The same bytes, reopened: a new project, never the old one.
    const { openImportedFile } = await import("./actions");
    await openImportedFile("vault.lattice.json", written);
    await until(() => doc.get().id !== project.id, "the reopened project to load");
    expect(doc.get().id).not.toBe(project.id);
    expect(doc.get().name).toBe("Vault");
    expect(bufferedServices().log.some((l) => l.text.startsWith("Opened Vault ·"))).toBe(true);
  });

  test("keeps an unknown top-level field, and says so (spec L289)", async () => {
    readyCatalog();
    testPersistence();
    const opened = await createProject(makeRecipe({}, catalog), "Vault");
    if (!opened.ok) throw new Error(opened.error);
    const text = JSON.stringify({
      project: { ...opened.value, extraField: "kept" },
      deployments: [],
    });
    const { openImportedFile } = await import("./actions");
    await openImportedFile("vault.lattice.json", text);
    await until(() => doc.get().id !== opened.value.id, "the imported project to load");
    expect(bufferedServices().log.some((l) => l.text === "Studio kept 1 field it doesn't recognize.")).toBe(true);
  });
});

describe("dropping a file", () => {
  test("opens a valid project file dropped on the window", async () => {
    readyCatalog();
    testPersistence();
    const before = doc.get().id;
    const target = document.createElement("div");
    document.body.appendChild(target);
    const stop = installFileDrop(target);
    onCleanup(() => {
      stop();
      target.remove();
    });

    const text = JSON.stringify({
      project: { id: "file-project", name: "FromFile", recipe: makeRecipe({}, catalog), layout: {}, deploy: { path: "factory", entropy: `0x${"00".repeat(11)}`, scope: "every-chain" }, provenance: {}, predicted: [] },
      deployments: [deployment("file-project", 1)],
    });
    const file = new File([text], "vault.lattice.json", { type: "application/json" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const event = new DragEvent("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    target.dispatchEvent(event);

    await until(() => doc.get().id !== before, "the dropped file to open");
    expect(doc.get().name).toBe("FromFile");
    expect(doc.get().id).not.toBe("file-project");
  });

  test("names the file, the path and the reason for a file that doesn't parse", async () => {
    readyCatalog();
    testPersistence();
    const target = document.createElement("div");
    document.body.appendChild(target);
    const stop = installFileDrop(target);
    onCleanup(() => {
      stop();
      target.remove();
    });

    const file = new File(["not json"], "recipe.json", { type: "application/json" });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const event = new DragEvent("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    target.dispatchEvent(event);

    await until(() => bufferedServices().toast.some((t) => t.kind === "error"), "the error toast");
    const line = bufferedServices().log.find((l) => l.tag === "Error");
    expect(line?.text).toContain("recipe.json");
    const toastLine = bufferedServices().toast.find((t) => t.kind === "error");
    expect(toastLine?.text).toBe(line?.text);
  });
});

describe("delete", () => {
  test("moves a project to Recently deleted with no confirmation, and Undo restores it", async () => {
    readyCatalog();
    const store = testPersistence();
    const opened = await createProject(makeRecipe({}, catalog), "Vault");
    if (!opened.ok) throw new Error(opened.error);
    const id = opened.value.id;

    const result = await runCommand({ id: "project.delete", args: { id } }, "api");
    expect(result.ok).toBe(true);
    expect((await store.listTrash()).some((t) => t.id === id)).toBe(true);
    expect((await store.listProjects()).some((p) => p.id === id)).toBe(false);

    const toast = bufferedServices().toast.at(-1);
    // spec L502, IR L218: the toast's button reads "Undo" (a label alongside the project.restore ref; S0's
    // ToastRegion reads it through FX14 — asserted here on the toast input, not the rendered button yet).
    expect(toast?.action).toEqual({ id: "project.restore", args: { id }, label: "Undo" });

    const undo = await runCommand(toast!.action!, "toast");
    expect(undo.ok).toBe(true);
    expect((await store.listProjects()).some((p) => p.id === id)).toBe(true);
    expect((await store.listTrash()).some((t) => t.id === id)).toBe(false);
  });

  test("restoring doesn't double-log: one line, even when records were skipped", async () => {
    readyCatalog();
    const store = testPersistence();
    // Trashed first, taking its record with it; only afterwards does another project claim that same
    // [chainId, address] key, so restoring `trashed` collides with what's there now (spec L292).
    const trashed = await createProject(makeRecipe({}, catalog), "Trashed");
    if (!trashed.ok) throw new Error(trashed.error);
    await putDeployment(deployment(trashed.value.id, 1));
    await store.deleteProject(trashed.value.id);

    const kept = await createProject(makeRecipe({}, catalog), "Kept");
    if (!kept.ok) throw new Error(kept.error);
    await putDeployment(deployment(kept.value.id, 1)); // Same [chainId, address] as `trashed`'s record.

    const before = bufferedServices().log.length;
    const { restoreProject } = await import("./actions");
    await restoreProject(trashed.value.id);
    const added = bufferedServices().log.slice(before);
    const restoredLines = added.filter((l) => l.text.startsWith("Restored Trashed"));
    // S7a's own restoreProject already logs the skipped-records line; actions.ts adds no second "Restored" line.
    expect(restoredLines).toHaveLength(1);
    expect(restoredLines[0]?.text).toContain("stays with the project that holds that address now");
  });
});

describe("export", () => {
  test("a trashed project's export still carries its deployment records (spec L502, L292, IR L185)", async () => {
    readyCatalog();
    const store = testPersistence();
    const created = await createProject(makeRecipe({}, catalog), "Vault");
    if (!created.ok) throw new Error(created.error);
    const id = created.value.id;
    await putDeployment(deployment(id, 1));
    await store.deleteProject(id);
    expect((await store.deployments.listDeployments(id))).toHaveLength(0); // Moved onto the trash entry.

    let captured: Blob | null = null;
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      captured = obj as Blob;
      return original(obj as Blob);
    };
    onCleanup(() => {
      URL.createObjectURL = original;
    });

    const { exportStoredProject } = await import("./actions");
    await exportStoredProject(id);

    expect(captured).not.toBeNull();
    const text = await captured!.text();
    const file = JSON.parse(text) as { project: { name: string }; deployments: unknown[] };
    expect(file.project.name).toBe("Vault");
    expect(file.deployments).toHaveLength(1);
  });

  test("Export all downloads with the multi-download hint when there's no directory picker", async () => {
    readyCatalog();
    testPersistence();
    const created = await createProject(makeRecipe({}, catalog), "Vault");
    if (!created.ok) throw new Error(created.error);

    const { exportAllData } = await import("./actions");
    await exportAllData();
    await until(() => bufferedServices().log.some((l) => l.text.startsWith("Downloading")), "the downloads note");
    const line = bufferedServices().log.at(-1);
    expect(line?.text).toMatch(/^Downloading \d+ files?\. If the browser asks, allow multiple downloads\.$/);
  });

  test("Export all writes straight to a picked directory when the File System Access API offers one", async () => {
    readyCatalog();
    testPersistence();
    const created = await createProject(makeRecipe({}, catalog), "Vault");
    if (!created.ok) throw new Error(created.error);

    const written = new Map<string, string>();
    (window as unknown as FsWindow).showDirectoryPicker = async () => ({
      getFileHandle: async (name: string) => ({
        name,
        createWritable: async () => ({
          write: async (text: string) => {
            written.set(name, text);
          },
          close: async () => {},
        }),
      }),
    });
    onCleanup(() => {
      delete (window as unknown as FsWindow).showDirectoryPicker;
    });

    const { exportAllData } = await import("./actions");
    await exportAllData();
    expect(written.size).toBeGreaterThan(0);
    const line = bufferedServices().log.at(-1);
    expect(line?.text).toMatch(/^Exported \d+ files?\.$/);
  });
});

describe("failures on an irreversible action", () => {
  test("Delete for good says why when the project already expired in another tab", async () => {
    readyCatalog();
    const store = testPersistence();
    const created = await createProject(makeRecipe({}, catalog), "Vault");
    if (!created.ok) throw new Error(created.error);
    const id = created.value.id;
    await store.deleteProject(id);
    // Another tab already deleted it for good (or it expired): this tab's copy of Recently deleted is stale.
    const gone = await store.deleteForGood(id);
    expect(gone.ok).toBe(true);

    const { deleteProjectForGood } = await import("./actions");
    const result = await deleteProjectForGood(id);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failure");
    expect(result.error).toBe("This project isn't in Recently deleted.");
    const errorLine = bufferedServices().log.at(-1);
    expect(errorLine?.tag).toBe("Error");
    expect(errorLine?.text).toContain(result.error);
  });
});

describe("the Safari tip", () => {
  test("Save a copy… shows the one-time Safari tip banner (spec L500)", async () => {
    readyCatalog();
    // `createPersistence` reads `navigator.userAgent` once, at construction: mock it before `testPersistence()`.
    const originalUA = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", {
      value: "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      configurable: true,
    });
    onCleanup(() => {
      Object.defineProperty(navigator, "userAgent", { value: originalUA, configurable: true });
    });
    testPersistence();
    const created = await createProject(makeRecipe({}, catalog), "Vault");
    if (!created.ok) throw new Error(created.error);

    const { saveCopy } = await import("./actions"); // No File System Access API: downloads and marks explicit.
    const saved = await saveCopy(created.value, "vault.lattice.json");
    expect(saved.ok).toBe(true);
    await until(() => bufferedServices().banners.has("projects.safari-tip"), "the Safari tip banner");
    expect(bufferedServices().banners.get("projects.safari-tip")?.text).toBe(
      "Safari can clear site data after 7 days without a visit, so keep a file copy.",
    );

    // A second save never asks again: the tip is one-time only.
    const { hideBanner } = await import("@/contracts");
    hideBanner("projects.safari-tip");
    const again = await saveCopy(created.value, "vault.lattice.json");
    expect(again.ok).toBe(true);
    expect(bufferedServices().banners.has("projects.safari-tip")).toBe(false);
  });
});
