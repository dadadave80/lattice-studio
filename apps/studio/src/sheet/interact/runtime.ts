/**
 * The interactions runtime: what S4e's pointer and key handlers and its commands do. The first load keeps only
 * what registers them (`services.ts`, `commands.ts`, `use-sheet-interactions.ts`); the runtime arrives with the
 * interactions layer, right after the canvas, or with the first command that needs it. Once it's here, calls
 * go straight through, so a key press acts at once.
 */
import type { Handlers } from "./handlers";
import type { Runs } from "./runs";

export type Runtime = { handlers: Handlers; runs: Runs };

let runtime: Runtime | null = null;
let loading: Promise<Runtime> | null = null;

/** The runtime registers itself when its module evaluates (`runtime-impl.ts`). */
export function provideRuntime(next: Runtime): void {
  runtime = next;
}

/** The runtime, if it has loaded. */
export function loadedRuntime(): Runtime | null {
  return runtime;
}

/** The runtime, loading it the first time. */
export function loadRuntime(): Promise<Runtime> {
  if (runtime) return Promise.resolve(runtime);
  loading ??= import("./runtime-impl").then(() => {
    if (!runtime) throw new Error("The sheet's interactions didn't load.");
    return runtime;
  });
  return loading;
}

/** Runs `fn` with the runtime: now when it's here, else once it has loaded. */
export function withRuntime<T>(fn: (r: Runtime) => T): T | Promise<T> {
  return runtime ? fn(runtime) : loadRuntime().then(fn);
}
