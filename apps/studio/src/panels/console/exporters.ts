/**
 * The exporters' lazy boundary (spec L822): each exporter is its own chunk, loaded on first use. Everything in
 * the entry chunk reaches an exporter only through `loadExporter`. `loadedExporters()` says which have loaded,
 * so tests can prove none loads before it's used.
 */
type Loaders = {
  foundry: () => Promise<typeof import("./exporters/foundry")>;
  brief: () => Promise<typeof import("./exporters/brief")>;
  recipe: () => Promise<typeof import("./exporters/recipe-json")>;
  safe: () => Promise<typeof import("./exporters/safe")>;
};

export type ExporterKind = keyof Loaders;

type Module<K extends ExporterKind> = Awaited<ReturnType<Loaders[K]>>;

const LOADERS: Loaders = {
  foundry: () => import("./exporters/foundry"),
  brief: () => import("./exporters/brief"),
  recipe: () => import("./exporters/recipe-json"),
  safe: () => import("./exporters/safe"),
};

const loaded = new Set<ExporterKind>();

export function loadExporter<K extends ExporterKind>(kind: K): Promise<Module<K>> {
  const load = LOADERS[kind] as () => Promise<Module<K>>;
  return load().then((module) => {
    loaded.add(kind);
    return module;
  });
}

/** The exporters loaded so far, in the order they first loaded. */
export function loadedExporters(): ExporterKind[] {
  return [...loaded];
}

/** @internal Tests: forget which exporters loaded (the modules stay cached by the browser). */
export function resetLoadedExporters(): void {
  loaded.clear();
}
