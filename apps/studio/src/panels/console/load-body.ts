/**
 * Loads the console body's chunk (`body.ts`) once: when the drawer first opens, or when a console command runs.
 * In the entry chunk; imports nothing but the `import()` itself.
 */
type Body = typeof import("./body");

let loading: Promise<Body> | null = null;
let loaded = false;

export function loadConsoleBody(): Promise<Body> {
  loading ??= import("./body").then(
    (body) => {
      loaded = true;
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
