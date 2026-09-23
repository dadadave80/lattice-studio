/**
 * Loads the console body's chunk (`body.ts`) once: when the drawer first opens, when a console command runs, or
 * when a code tab or the Export menu is pointed at. In the entry chunk; imports nothing but the `import()`.
 * A chunk that can't load is reported by the PWA's watcher, which Vite tells through `vite:preloadError`.
 */
type Body = typeof import("./body");

let loading: Promise<Body> | null = null;
let loaded = false;
const listeners = new Set<() => void>();

export function loadConsoleBody(): Promise<Body> {
  loading ??= import("./body").then(
    (body) => {
      loaded = true;
      for (const listener of Array.from(listeners)) listener();
      return body;
    },
    (error: unknown) => {
      // A failed fetch (offline, a new deploy) is tried again on the next open or command.
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** Whether the body's chunk has arrived. */
export function consoleBodyLoaded(): boolean {
  return loaded;
}

/** Calls `listener` when the body's chunk arrives. Returns the unsubscriber. */
export function subscribeConsoleBody(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
