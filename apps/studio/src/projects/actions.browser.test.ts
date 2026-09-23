/**
 * S7b's commands against real IndexedDB (`testPersistence`) and a real drop event: New project's reset,
 * the save-and-reopen round trip through the File System Access API, dropping a bad file, delete with
 * Undo, and the unknown-fields line (spec L289).
 */
import { toChecksum, type Deployment } from "@lattice-studio/core";
import { makeRecipe } from "@lattice-studio/core/testing";
import { afterEach, describe, expect, test } from "vitest";
import {
  createProject, doc, loadViewport, runCommand, saveViewport, session, setCatalogStatus,
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

    // ⌘S again: writes the linked handle directly, without reopening Save a copy.
    written = "";
    let openedDialog = false;
    await saveOrPrompt(doc.get(), () => {
      openedDialog = true;
    });
    expect(openedDialog).toBe(false);
    expect(written).toContain('"Vault"');
    expect(written).toBe(firstWrite);

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
    expect(toast?.action).toEqual({ id: "project.restore", args: { id } });

    const undo = await runCommand(toast!.action!, "toast");
    expect(undo.ok).toBe(true);
    expect((await store.listProjects()).some((p) => p.id === id)).toBe(true);
    expect((await store.listTrash()).some((t) => t.id === id)).toBe(false);
  });
});
