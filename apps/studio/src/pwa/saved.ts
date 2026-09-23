/** When a reload loses nothing: the project is saved, or the tab is read-only with nothing of its own to save. */
import type { SaveStatus } from "@/contracts";

export function safeToReload(status: SaveStatus): boolean {
  return status.state === "saved" || status.state === "read-only";
}

export type SaveWatch = {
  saveStatus(): SaveStatus;
  subscribeSaveStatus(listener: (status: SaveStatus) => void): () => void;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

/**
 * Resolves with the save status once no save is pending (at once when none is), or null when a save is
 * still running after `waitMs`.
 */
export function settledSave(deps: SaveWatch, waitMs: number): Promise<SaveStatus | null> {
  return new Promise((resolve) => {
    const first = deps.saveStatus();
    if (first.state !== "saving") {
      resolve(first);
      return;
    }
    let timer: unknown = null;
    const stop = deps.subscribeSaveStatus((status) => {
      if (status.state !== "saving") finish(status);
    });
    function finish(status: SaveStatus | null): void {
      stop();
      if (timer !== null) deps.clearTimeout(timer);
      resolve(status);
    }
    timer = deps.setTimeout(() => finish(null), waitMs);
  });
}
