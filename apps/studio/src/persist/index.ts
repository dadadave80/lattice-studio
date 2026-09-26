/**
 * Persistence (spec L117): IndexedDB projects and deployment records in separate stores, autosave, Recently
 * deleted, the edit lock between tabs, per-project viewports and persistent storage. The projects and
 * deployments services reach the rest of the app through the contracts (§5.2); what the Projects dialog
 * (S7b), the two-tab flow (S13), Settings → Data (S10) and Save and reload (S11a) need is here:
 *
 *   const store = await persistence();
 *   await store.deleteProject(id);             // to Recently deleted, with its records
 *   const counts = await store.trashCounts(id); // "This deletes the only record of 2 deployed addresses."
 *   subscribeEditLock((lock) => …);            // S13: read-only banners
 *   showOpenFailure(reason, [detail]);         // the sheet's "This project couldn't be opened: {reason}"
 *
 * Importing this file loads no IndexedDB code; `persistence()` does, on first call.
 */
import { persistence } from "./current";

export {
  bootPersistence, clearOpenFailure, editLockState, openFailure, openFailureText, persistence, providePersistence,
  showOpenFailure, subscribeEditLock, subscribeOpenFailure, subscribeProjects, useEditLock, useOpenFailure,
} from "./current";
export type { OpenFailure } from "./current";
export type { EditLockState } from "./lock";
export type {
  DocPort, ExplicitSave, ImportResult, PersistedDeployments, Persistence, PersistenceOptions, StorageInfo, StoragePort,
} from "./persistence";
export type { ClearDataCounts, ProjectSummary, RecordCounts, Restored, TrashSummary } from "./records";

/** Writes the pending autosave now (Save and reload, spec L605). */
export async function flushPendingSave(): Promise<void> {
  await (await persistence()).flush();
}
