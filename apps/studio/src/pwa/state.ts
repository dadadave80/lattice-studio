/**
 * What the PWA module shares between its entry-chunk half (registration, chunk failures, the connection) and
 * its lazy half (the service worker): whether a chunk failed, the running update controller, and how the
 * page reloads (tests replace it).
 */

/** The update controller's side of a reload: activates a waiting worker first when there is one. */
export type UpdateHandle = { reload(): Promise<void> };

let chunkFailed = false;
let updates: UpdateHandle | null = null;
let reloadPage: () => void = () => window.location.reload();
const changed = new Set<() => void>();

export const pwaState = {
  chunkFailed: () => chunkFailed,
  /** Marks that a chunk failed to load. Returns true the first time. */
  markChunkFailed(): boolean {
    if (chunkFailed) return false;
    chunkFailed = true;
    for (const listener of Array.from(changed)) listener();
    return true;
  },
  updates: () => updates,
  setUpdates(handle: UpdateHandle | null): void {
    updates = handle;
  },
  reloadPage: () => reloadPage(),
  subscribe(listener: () => void): () => void {
    changed.add(listener);
    return () => {
      changed.delete(listener);
    };
  },
};

/** @internal Tests: replaces the page reload and resets the state; returns a disposer that restores both. */
export function isolatePwaState(reload: () => void): () => void {
  const saved = { chunkFailed, updates, reloadPage };
  chunkFailed = false;
  updates = null;
  reloadPage = reload;
  return () => {
    ({ chunkFailed, updates, reloadPage } = saved);
  };
}
