/**
 * The business logic behind S7b's commands: everything that touches persistence, the File System Access API
 * or core's parsing, kept out of `cmd/*.ts` and `commands.ts` (the entry chunk) and reached only through a
 * dynamic `import()` from a command's `run()`, so opening a project or exporting one never grows the first
 * load (contracts §6, the size gate).
 */
import { exportProjectFile, plural, type Deployment, type Project, type Recipe } from "@lattice-studio/core";
import {
  commandRef, createProject as createProjectService, getCatalog, listDeployments, log, openProject as openProjectService,
  runCommand, showBanner, toast,
} from "@/contracts";
import { persistence } from "@/persist";
import { downloadFile, forgetHandle, linkedHandle, saveProjectAs, writeLinked } from "./file-io";
import { resetForProjectSwitch, sayError, sayNote } from "./cmd/shared";

export { openImportedFile } from "./import-file";

function emptyRecipe(): Recipe {
  const catalog = getCatalog();
  return {
    schemaVersion: 1,
    catalog: catalog ? { tag: catalog.lattice.tag, hash: catalog.hash } : { tag: "", hash: `0x${"00".repeat(32)}` },
    facets: [],
    owners: {},
    exclude: [],
    init: { kind: "none" },
  };
}

/** New project (App menu, `new`): a blank sheet, modes, selection and viewport reset (PA #5, #16). */
export async function startNewProject(): Promise<void> {
  const created = await createProjectService(emptyRecipe(), "Untitled");
  if (!created.ok) {
    sayError(`Couldn't start a new project. ${created.error}`);
    return;
  }
  resetForProjectSwitch();
  sayNote("New project.");
}

/** Opens a stored project by id, logging "Opened X · N facets · saved 2 min ago." (spec L708). */
export async function openStoredProject(id: string): Promise<void> {
  const store = await persistence();
  const before = (await store.listProjects()).find((p) => p.id === id);
  const opened = await openProjectService(id);
  if (!opened.ok) {
    sayError(`Couldn't open this project. ${opened.error}`);
    return;
  }
  resetForProjectSwitch();
  const savedAt = before?.savedAt ?? Date.now();
  const ago = relativeTime(savedAt);
  sayNote(`Opened ${opened.value.name} · ${plural(opened.value.recipe.facets.length, "facet")} · saved ${ago}.`);
}

function relativeTime(savedAtMs: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - savedAtMs) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

async function currentDeployments(project: Project): Promise<readonly Deployment[]> {
  return listDeployments(project.id);
}

/** ⌘S: writes the linked file, or opens Save a copy (spec L497). Returns whether it wrote directly. */
export async function saveOrPrompt(project: Project, openSaveCopy: (filename: string) => void): Promise<void> {
  const handle = linkedHandle(project.id);
  const file = exportProjectFile(project, await currentDeployments(project));
  if (!handle) {
    openSaveCopy(file.filename);
    return;
  }
  const written = await writeLinked(project.id, file);
  if (!written.ok) {
    sayError(`Couldn't save to ${handle.name}. ${written.error}`);
    openSaveCopy(file.filename);
    return;
  }
  sayNote(`Saved to ${handle.name}.`);
  await afterExplicitSave();
}

/** Save a copy…'s dialog action: picks where to save (or downloads), then links `project` to it for ⌘S. */
export async function saveCopy(project: Project, filename: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = exportProjectFile(project, await currentDeployments(project));
  const file = { ...base, filename };
  const outcome = await saveProjectAs(project.id, file);
  if (!outcome.ok) return "cancelled" in outcome ? { ok: true } : outcome;
  sayNote(`Saved to ${outcome.filename}.`);
  await afterExplicitSave();
  return { ok: true };
}

const SAFARI_BANNER = "projects.safari-tip";

/** After ⌘S or Save a copy: asks for persistent storage once, and shows Safari's one-time tip (spec L500). */
async function afterExplicitSave(): Promise<void> {
  const store = await persistence();
  const { safariTip } = await store.markExplicitSave();
  if (safariTip) {
    showBanner(SAFARI_BANNER, {
      text: "Safari can clear site data after 7 days without a visit, so keep a file copy.",
      tone: "info",
      dismissible: true,
    });
  }
}

/** Exports the open project (Export ▸ Project file, `export project`): same as Save a copy…. */
export async function exportCurrentProject(project: Project, openSaveCopy: (filename: string) => void): Promise<void> {
  const file = exportProjectFile(project, await currentDeployments(project));
  openSaveCopy(file.filename);
}

/** Renames a stored project: the open one through `project.rename` (S1), any other through persistence. */
export async function renameStoredProject(id: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const store = await persistence();
  if (store.documentId() === id) {
    const result = await runCommand({ id: "project.rename", args: { name } }, "menu");
    return result.ok ? { ok: true } : { ok: false, error: result.reason };
  }
  const renamed = await store.renameProject(id, name);
  return renamed.ok ? { ok: true } : { ok: false, error: renamed.error };
}

export async function duplicateProject(id: string): Promise<void> {
  const store = await persistence();
  const duplicated = await store.duplicateProject(id);
  if (!duplicated.ok) {
    sayError(`Couldn't duplicate this project. ${duplicated.error}`);
    return;
  }
  sayNote(`Duplicated as ${duplicated.value.name}.`);
}

/** Exports a stored (not necessarily open) project as a `.lattice.json`, with its deployment records. */
export async function exportStoredProject(id: string): Promise<void> {
  const store = await persistence();
  const rows = await store.listProjects();
  const row = rows.find((p) => p.id === id);
  const project = row?.project ?? (await store.listTrash()).find((t) => t.id === id)?.project;
  if (!project) {
    sayError("Couldn't export this project. It's no longer stored here.");
    return;
  }
  const deployments = await store.deployments.listDeployments(id);
  downloadFile(exportProjectFile(project, deployments));
}

/** Delete (Projects list): to Recently deleted, no confirmation, with Undo in the toast (spec L502). */
export async function deleteProject(id: string): Promise<void> {
  const store = await persistence();
  const rows = await store.listProjects();
  const name = rows.find((p) => p.id === id)?.name ?? "Project";
  const deleted = await store.deleteProject(id);
  if (!deleted.ok) {
    sayError(`Couldn't delete ${name}. ${deleted.error}`);
    return;
  }
  forgetHandle(id);
  log({ tag: "Note", text: `Moved ${name} to Recently deleted.` });
  toast({ text: `Moved ${name} to Recently deleted`, action: commandRef("project.restore", { id }) });
}

export async function restoreProject(id: string): Promise<void> {
  const store = await persistence();
  const restored = await store.restoreProject(id);
  if (!restored.ok) {
    sayError(`Couldn't restore this project. ${restored.error}`);
    return;
  }
  sayNote(`Restored ${restored.value.project.name}.`);
}

export async function deleteProjectForGood(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const store = await persistence();
  const rows = await store.listTrash();
  const name = rows.find((p) => p.id === id)?.name ?? "Project";
  const gone = await store.deleteForGood(id);
  if (!gone.ok) return gone;
  forgetHandle(id);
  sayNote(`Deleted ${name} for good.`);
  return { ok: true };
}

/** Export all (Settings → Data): one download per stored file. Staggered, since several `<a download>`
 * clicks in one tick can be treated as pop-up spam. */
export async function exportAllData(): Promise<void> {
  const store = await persistence();
  const files = await store.exportAll();
  if (files.length === 0) {
    sayNote("There's nothing stored to export.");
    return;
  }
  files.forEach((file, i) => setTimeout(() => downloadFile(file), i * 150));
  sayNote(`Exported ${plural(files.length, "file")}.`);
}

export async function clearAllData(): Promise<{ ok: true } | { ok: false; error: string }> {
  const store = await persistence();
  try {
    await store.clearData();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  sayNote("Cleared Studio's data in this browser.");
  return { ok: true };
}
