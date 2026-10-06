/**
 * @internal For S1's `bun test` files: fresh contracts, the fixture catalog loaded, a fresh S1 state installed
 * and S1's commands registered, all undone by `dispose()`. Settings stay in memory. Never imported by the app.
 */
import type { Catalog, ConsoleLine, Project } from "@lattice-studio/core";
import { analyze, CORE_FACETS, narrate } from "@lattice-studio/core";
import { loadFixtureCatalog, makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { defineCommands, doc, provideServices, setCatalogStatus } from "@/contracts";
import { bufferedServices } from "@/contracts/services";
import { isolateContracts } from "@/contracts/test-support";
import { S1_COMMANDS } from "./cmd";
import { loadRuns } from "./cmd/lazy";
import { createStudioState, installStudioState, type StudioState, type StudioStateOptions } from "./runtime";

// The commands' bodies up front, as the app has them by the time anyone edits, so a run acts at once.
await loadRuns();

let cached: Catalog | null = null;

export function fixture(): Catalog {
  if (cached) return cached;
  const loaded = loadFixtureCatalog();
  if (!loaded.ok) throw new Error(loaded.error);
  cached = loaded.value;
  return cached;
}

export type Kit = {
  state: StudioState;
  catalog: Catalog;
  /** Moves the injected clock (bursts). */
  clock: { now: number };
  /** Lines logged since the kit started (or since `clearLines`). */
  lines(): ConsoleLine[];
  texts(): string[];
  clearLines(): void;
  dispose(): void;
};

export type KitOptions = StudioStateOptions & {
  /** Load core's analysis from its own chunk, as the app does (`analyzer.ts`). */
  lazyAnalysis?: boolean;
  project?: Project;
  /** Null leaves the catalog loading. */
  catalog?: Catalog | null;
};

export function setupKit(options: KitOptions = {}): Kit {
  const restoreContracts = isolateContracts();
  const clock = { now: Date.parse("2026-01-01T00:00:00.000Z") };
  const disposeClock = provideServices({ now: () => clock.now });
  const catalog = options.catalog === undefined ? fixture() : options.catalog;
  if (catalog) setCatalogStatus({ status: "ready", id: catalog.lattice.tag, catalog, manifest: null });
  // An empty sheet is a core-only recipe with the empty step plan, as the app's untitled project is.
  const empty = makeRecipe({ facets: [...CORE_FACETS], init: { kind: "steps", steps: [] } }, catalog ?? undefined);
  doc.load(options.project ?? makeProject({ recipe: empty }));
  let from = bufferedServices().log.length;
  // Core's analysis at once, rather than from its lazy chunk (`analyzer.ts`), so a test reads it right after an edit.
  const { lazyAnalysis = false, ...rest } = options;
  const state = createStudioState({ storage: null, ...(lazyAnalysis ? {} : { analyze, narrate }), ...rest });
  const uninstall = installStudioState(state);
  defineCommands(S1_COMMANDS);
  const lines = (): ConsoleLine[] => bufferedServices().log.slice(from);
  return {
    state,
    catalog: catalog ?? fixture(),
    clock,
    lines,
    texts: () => lines().map((l) => l.text),
    clearLines: () => {
      from = bufferedServices().log.length;
    },
    dispose() {
      uninstall();
      disposeClock();
      restoreContracts();
    },
  };
}

/** Lets queued microtasks (narration, prediction records, pinning) run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
