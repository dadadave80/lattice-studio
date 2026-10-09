/**
 * What the canvas needs registered before React Flow first renders, loaded with the canvas chunk (spec L818, Q19):
 * the facet card as the "facet" node type, and the layers that use React Flow's hooks. A module's `services.ts`
 * registers a loader here at module evaluation, and the loaded module makes the contracts' registrations
 * (`registerNodeType`, `registerSheetLayer`). The node and edge type objects keep one identity for the app's
 * lifetime (`flow-types.ts`), so registering into them later changes nothing React Flow sees.
 *
 * Kept free of imports: it's in the entry, and so is every file that calls it.
 */
const loaders: (() => Promise<unknown>)[] = [];
let loading: Promise<void> | null = null;

/** Adds a module the canvas loads before it renders. Call it at module evaluation, in `services.ts`. */
export function registerSheetParts(load: () => Promise<unknown>): void {
  loaders.push(load);
}

/** Loads every registered part once; the canvas awaits it, and browser tests await it in their setup. */
export function loadSheetParts(): Promise<void> {
  loading ??= Promise.all(loaders.map((load) => load())).then(
    () => undefined,
    (error: unknown) => {
      // A chunk that failed to load can be asked for again (the PWA's chunk-error watcher offers a reload).
      loading = null;
      throw error;
    },
  );
  return loading;
}
