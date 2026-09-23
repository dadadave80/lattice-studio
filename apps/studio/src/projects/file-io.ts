/**
 * Reading and writing files on disk (Flow 10 steps 2 and 4, spec L497-L501). Chromium's File System Access
 * API links a project to a file, so later ⌘S writes it directly; every other browser downloads. Handles are
 * kept in memory only (`handles`), per tab: a reload always reopens through Save a copy.
 */
import type { ExportFile } from "@lattice-studio/core";
import { fsWindow, isAbort, type FsFileHandle } from "./fs-types";

export type SaveAllOutcome = { ok: true; via: "directory" | "downloads" } | { ok: false; cancelled: true };

/**
 * Export all and Clear data's Export first (spec L637): with the File System Access API, one directory pick
 * writes every file straight to disk, no download prompts. Elsewhere it falls back to a download per file,
 * which Chromium treats as multiple downloads and may ask to allow.
 */
export async function saveAllTo(files: readonly ExportFile[]): Promise<SaveAllOutcome> {
  const w = fsWindow();
  if (w?.showDirectoryPicker) {
    try {
      const dir = await w.showDirectoryPicker();
      for (const file of files) {
        const handle = await dir.getFileHandle(file.filename, { create: true });
        const writable = await handle.createWritable();
        await writable.write(file.text);
        await writable.close();
      }
      return { ok: true, via: "directory" };
    } catch (error) {
      if (isAbort(error)) return { ok: false, cancelled: true };
      // Falls back to downloads for the same reasons as the save and open paths.
    }
  }
  files.forEach((file, i) => setTimeout(() => downloadFile(file), i * 150));
  return { ok: true, via: "downloads" };
}

const handles = new Map<string, FsFileHandle>();

/** The file `projectId` is linked to, if any (⌘S writes it directly). */
export function linkedHandle(projectId: string): FsFileHandle | null {
  return handles.get(projectId) ?? null;
}

/** Forgets a project's linked file (it moved to Recently deleted, was deleted for good, or storage was cleared). */
export function forgetHandle(projectId: string): void {
  handles.delete(projectId);
}

/** Triggers a browser download of `file`: the only path without the File System Access API. */
export function downloadFile(file: ExportFile): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([file.text], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type SaveOutcome =
  | { ok: true; filename: string; linked: boolean }
  | { ok: false; cancelled: true }
  | { ok: false; error: string };

/**
 * Save a copy…: with the File System Access API, asks where to save and links `projectId` to that file for
 * later ⌘S; otherwise downloads. `AbortError` (the person cancelled the native picker) comes back as
 * `cancelled`, never as an error.
 */
export async function saveProjectAs(projectId: string, file: ExportFile): Promise<SaveOutcome> {
  const w = fsWindow();
  if (w?.showSaveFilePicker) {
    try {
      const handle = await w.showSaveFilePicker({
        // A two-part extension like ".lattice.json" throws in Chromium's `accept`; the suggested name still
        // carries it in full, so the picker still offers "vault.lattice.json" as the default.
        suggestedName: file.filename,
        types: [{ description: "Lattice Studio project", accept: { "application/json": [".json"] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(file.text);
      await writable.close();
      handles.set(projectId, handle);
      return { ok: true, filename: handle.name, linked: true };
    } catch (error) {
      if (isAbort(error)) return { ok: false, cancelled: true };
      // Some browsers advertise the API but refuse it (permissions, an iframe): fall back to a download.
    }
  }
  downloadFile(file);
  return { ok: true, filename: file.filename, linked: false };
}

/** ⌘S with a linked file: writes it directly. Forgets the handle on failure, so the next ⌘S opens Save a copy. */
export async function writeLinked(projectId: string, file: ExportFile): Promise<{ ok: true } | { ok: false; error: string }> {
  const handle = handles.get(projectId);
  if (!handle) return { ok: false, error: "No linked file." };
  try {
    const writable = await handle.createWritable();
    await writable.write(file.text);
    await writable.close();
    return { ok: true };
  } catch (error) {
    handles.delete(projectId);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export type PickedFile = { filename: string; text: string };

function readFile(file: File): Promise<PickedFile> {
  return file.text().then((text) => ({ filename: file.name, text }));
}

/** A hidden `<input type=file>`: the fallback for browsers without `showOpenFilePicker`. Null: cancelled. */
function pickWithInput(): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") {
      resolve(null);
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json,.lattice.json";
    input.style.display = "none";
    let settled = false;
    const done = (value: PickedFile | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        if (!file) {
          done(null);
          return;
        }
        readFile(file).then(done).catch(() => done(null));
      },
      { once: true },
    );
    // Modern browsers fire "cancel" on the input itself when the native picker closes with nothing chosen;
    // "change" always fires first when a file was chosen, so `settled` already guards the ordering.
    input.addEventListener("cancel", () => done(null), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/** ⌘/Ctrl O and Open… (Flow 10 step 4): picks a file from disk. Null: the person cancelled. */
export async function pickProjectFile(): Promise<PickedFile | null> {
  const w = fsWindow();
  if (w?.showOpenFilePicker) {
    try {
      const [handle] = await w.showOpenFilePicker({
        multiple: false,
        types: [{ description: "Lattice project or recipe", accept: { "application/json": [".json"] } }],
      });
      if (!handle) return null;
      const file = await handle.getFile?.();
      return file ? readFile(file) : null;
    } catch (error) {
      if (isAbort(error)) return null;
      // Falls back to the input picker for the same reason as the save path.
    }
  }
  return pickWithInput();
}

/** A file dropped on the window (Flow 10 step 4). */
export function pickDroppedFile(transfer: DataTransfer): Promise<PickedFile | null> {
  const file = transfer.files[0];
  return file ? readFile(file) : Promise.resolve(null);
}
