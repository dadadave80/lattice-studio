/**
 * Tells `ProjectsDialogPanel` to refetch its list right away, for a change persist's own `emitProjects`
 * doesn't cover: an in-place `project.rename` (S1's `project.rename` command, run when the open project
 * renames itself) only edits the document. Autosave then writes it to storage without calling `emitProjects`
 * (persist/persistence.ts's `write`, frozen), so the dialog's Recent row would keep the old name until the
 * dialog closes and reopens. `renameStoredProject` (actions.ts) flushes the write, then notifies here;
 * `ProjectsDialogPanel` refetches alongside its own `subscribeProjects`.
 */
const listeners = new Set<() => void>();

/** `ProjectsDialogPanel`'s own refetch, called after an in-place rename lands in storage. */
export function subscribeProjectsRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function notifyProjectsRefresh(): void {
  for (const listener of Array.from(listeners)) listener();
}
