/**
 * The business logic behind S7b's commands: everything that touches persistence, the File System Access API
 * or core's parsing, kept out of `cmd/*.ts` and `commands.ts` (the entry chunk) and reached only through a
 * dynamic `import()` from a command's `run()`, so opening a project or exporting one never grows the first
 * load (contracts §6, the size gate).
 */
import {
  CORE_FACETS, exportProjectFile, isCoreFacet, lines, plural, type CommandRef, type Deployment, type Project, type Recipe, type Result,
} from "@lattice-studio/core";
import {
  announce, commandRef, createProject as createProjectService, getCatalog, listDeployments, log,
  openProject as openProjectService, runCommand, showBanner, toast,
} from "@/contracts";
import { flushPendingSave, persistence } from "@/persist";
import { downloadFile, forgetHandle, linkedHandle, saveAllTo, saveProjectAs, writeLinked } from "./file-io";
import { reportOpenFailure, resetForProjectSwitch, sayError, sayNote } from "./cmd/shared";
import { notifyProjectsRefresh } from "./list-refresh";

export { openImportedFile } from "./import-file";

function emptyRecipe(): Recipe {
  const catalog = getCatalog();
  return {
    schemaVersion: 1,
    catalog: catalog ? { tag: catalog.lattice.tag, hash: catalog.hash } : { tag: "", hash: `0x${"00".repeat(32)}` },
    // Core only: nothing placed. The empty step plan keeps the automatic introspection step.
    facets: [...CORE_FACETS],
    owners: {},
    exclude: [],
    init: { kind: "steps", steps: [] },
  };
}

/** New project (App menu, `new`): a blank sheet, modes, selection and viewport reset (PA #5, #16). */
export async function startNewProject(): Promise<Result<void, string>> {
  const created = await createProjectService(emptyRecipe(), "Untitled");
  if (!created.ok) {
    sayError(`Couldn't start a new project. ${created.error}`);
    return created;
  }
  resetForProjectSwitch();
  sayNote("New project.");
  return { ok: true, value: undefined };
}

/** Opens a stored project by id, logging "Opened X · N facets · saved 2 min ago." through core's own line
 * builder (spec L708), so the relative time matches every other line that reports one. */
export async function openStoredProject(id: string): Promise<Result<void, string>> {
  const store = await persistence();
  const before = (await store.listProjects()).find((p) => p.id === id);
  const opened = await openProjectService(id);
  if (!opened.ok) {
    reportOpenFailure(opened.error);
    return opened;
  }
  resetForProjectSwitch();
  const now = new Date().toISOString();
  const savedAt = before ? new Date(before.savedAt).toISOString() : now; // No prior record: "saved just now".
  const line = lines.projectOpened({ name: opened.value.name, facets: opened.value.recipe.facets.filter((name) => !isCoreFacet(name)).length, savedAt, now });
  log(line);
  announce(line.text);
  return { ok: true, value: undefined };
}

async function currentDeployments(project: Project): Promise<readonly Deployment[]> {
  return listDeployments(project.id);
}

/**
 * The toast ("Saved to X", spec L497) is also the one console line (spec L733: `toast()` logs it) and its
 * own accessible announcement (Base UI's toast viewport is `aria-live="polite"`), so nothing else says it.
 */
function announceSaved(filename: string): void {
  toast({ text: `Saved to ${filename}` });
}

/** ⌘S: writes the linked file, or opens Save a copy (spec L497). */
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
  announceSaved(handle.name);
  await afterExplicitSave();
}

/** Save a copy…'s dialog action: picks where to save (or downloads), then links `project` to it for ⌘S. */
export async function saveCopy(project: Project, filename: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = exportProjectFile(project, await currentDeployments(project));
  const file = { ...base, filename };
  const outcome = await saveProjectAs(project.id, file);
  if (!outcome.ok) return "cancelled" in outcome ? { ok: true } : outcome;
  announceSaved(outcome.filename);
  await afterExplicitSave();
  return { ok: true };
}

const SAFARI_BANNER = "projects.safari-tip";

/** After ⌘S or Save a copy: asks for persistent storage once, and shows Safari's one-time tip (spec L500). */
async function afterExplicitSave(): Promise<void> {
  try {
    const store = await persistence();
    const { safariTip } = await store.markExplicitSave();
    if (safariTip) {
      showBanner(SAFARI_BANNER, {
        text: "Safari can clear site data after 7 days without a visit, so keep a file copy.",
        tone: "info",
        dismissible: true,
      });
    }
  } catch (error) {
    sayError(`Couldn't update browser storage settings. ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Renames a stored project: the open one through `project.rename` (S1), any other through persistence.
 * `project.rename` only edits the document; it never calls persist's `emitProjects` (frozen), so the
 * Projects dialog's own row would keep the old name until it closed and reopened. Flushing the rename to
 * storage right away, then notifying `list-refresh`'s own subscribers, keeps the row live instead.
 */
export async function renameStoredProject(id: string, name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const store = await persistence();
    if (store.documentId() === id) {
      const result = await runCommand({ id: "project.rename", args: { name } }, "menu");
      if (!result.ok) return { ok: false, error: result.reason };
      await flushPendingSave();
      notifyProjectsRefresh();
      return { ok: true };
    }
    const renamed = await store.renameProject(id, name);
    if (renamed.ok) return { ok: true };
    sayError(`Couldn't rename this project. ${renamed.error}`);
    return renamed;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    sayError(`Couldn't rename this project. ${reason}`);
    return { ok: false, error: reason };
  }
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

/**
 * Exports a stored (not necessarily open) project as a `.lattice.json`, with its deployment records. A
 * trashed project's records live on its `TrashSummary` (`trashProject`, persist/records.ts): the deployments
 * store no longer indexes them by that project id, so `listDeployments` alone would export none.
 */
export async function exportStoredProject(id: string): Promise<void> {
  const file = await (await persistence()).exportProject(id);
  if (file) downloadFile(file);
  else sayError("Couldn't export this project. It's no longer stored here.");
}

/** Extends a `CommandRef` with a display label a toast's action button can show instead of the command's own title. */
function labeled(ref: CommandRef, label: string): CommandRef & { label: string } {
  return { ...ref, label };
}

/** Delete (Projects list): to Recently deleted, no confirmation, with Undo in the toast (spec L502, IR L218). */
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
  // The toast is the one console line too (spec L733), so nothing here logs it a second time.
  toast({ text: `Moved ${name} to Recently deleted`, action: labeled(commandRef("project.restore", { id }), "Undo") });
}

/** Restore (Recently deleted). S7a's own `restoreProject` already logs a line when it kept records back
 * (`skipped`); this only adds the plain "Restored X." console line, or (when that line already ran)
 * announces it to the status region without a second console line. */
export async function restoreProject(id: string): Promise<void> {
  const store = await persistence();
  const restored = await store.restoreProject(id);
  if (!restored.ok) {
    sayError(`Couldn't restore this project. ${restored.error}`);
    return;
  }
  const { project, skipped } = restored.value;
  if (skipped > 0) announce(`Restored ${project.name}.`);
  else sayNote(`Restored ${project.name}.`);
}

export async function deleteProjectForGood(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const store = await persistence();
  const rows = await store.listTrash();
  const name = rows.find((p) => p.id === id)?.name ?? "Project";
  const gone = await store.deleteForGood(id);
  if (!gone.ok) {
    sayError(`Couldn't delete ${name} for good. ${gone.error}`);
    return gone;
  }
  forgetHandle(id);
  sayNote(`Deleted ${name} for good.`);
  return { ok: true };
}

/** Export all (Settings → Data): one directory pick through the File System Access API where it exists,
 * else a download per stored file (spec L637). */
export type ExportAllDataResult =
  | { ok: true; via: "directory" | "downloads"; source: Project; count: number }
  | { ok: false; cancelled: true }
  | { ok: false; empty: true }
  | { ok: false; error: string };

export async function exportAllData(): Promise<ExportAllDataResult> {
  try {
    const store = await persistence();
    const source = store.document();
    const files = await store.exportAll();
    if (files.length === 0) {
      sayNote("There's nothing stored to export.");
      return { ok: false, empty: true };
    }
    const outcome = await saveAllTo(files);
    if (!outcome.ok) return outcome;
    if (outcome.via === "directory") sayNote(`Exported ${plural(files.length, "file")}.`);
    else sayNote(`Downloading ${plural(files.length, "file")}. If the browser asks, allow multiple downloads.`);
    return { ok: true, via: outcome.via, source, count: files.length };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const message = `Couldn't export all projects. ${reason} Save a copy to recover the current project.`;
    sayError(message);
    return { ok: false, error: message };
  }
}

export async function clearAllData(exportedFrom: Project | null = null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const store = await persistence();
    if (exportedFrom !== null && store.document() !== exportedFrom) {
      return { ok: false, error: "The current project changed after export. Export again before deleting." };
    }
    await store.clearData(exportedFrom ?? undefined);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    sayError(`Couldn't clear Studio's data. ${reason}`);
    return { ok: false, error: reason };
  }
  sayNote("Cleared Studio's data in this browser. Start a new project or open a project file to continue.");
  return { ok: true };
}
