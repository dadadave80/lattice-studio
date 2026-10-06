/**
 * S1's command bodies load in their own chunk (`runs.ts`), asked for once the state is installed, so not in first
 * load (spec L822, Q19): the edits they make pull in core's edit, layout and recipe code. Each command's title,
 * keys, console verb and enablement stay in the entry, so every command is listed, bound and checked from the
 * start; one run before the chunk arrives waits for it, then runs and says what it did, as it always does.
 */
import type { CommandContext } from "@/contracts";

type Runs = typeof import("./runs");

let runs: Runs | null = null;
let loading: Promise<Runs> | null = null;

/** The bodies, loading them the first time. */
export function loadRuns(): Promise<Runs> {
  if (runs) return Promise.resolve(runs);
  loading ??= import("./runs").then(
    (loaded) => {
      runs = loaded;
      return loaded;
    },
    (error: unknown) => {
      // A chunk that failed to load can be asked for again (the PWA's chunk-error watcher offers a reload).
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** What a body takes after the context; `unknown` for one that takes nothing. */
type ArgsOf<F> = F extends (ctx: CommandContext, args: infer A) => unknown ? A : never;

/** A command's `run` from the bodies' chunk: at once when it's here, else once it has loaded. */
export function lazyRun<K extends keyof Runs>(name: K) {
  type Args = ArgsOf<Runs[K]>;
  return (ctx: CommandContext, args: Args): void | Promise<void> => {
    const go = (loaded: Runs): void | Promise<void> => (loaded[name] as (c: CommandContext, a: Args) => void | Promise<void>)(ctx, args);
    return runs ? go(runs) : loadRuns().then(go);
  };
}
