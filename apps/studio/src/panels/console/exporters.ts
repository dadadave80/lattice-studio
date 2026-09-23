/**
 * The exporters' lazy boundary (spec L822): the exporters are one chunk (`exporters/index.ts`), loaded on the
 * first export. Everything else reaches an exporter only through `loadExporter`. `loadedExporters()` says which
 * exporters have been asked for, so tests can prove none loads before it's used.
 */
type Exporters = typeof import("./exporters/index");

const PICK = {
  foundry: (m: Exporters) => ({ foundryScript: m.foundryScript }),
  brief: (m: Exporters) => ({ agentBrief: m.agentBrief }),
  recipe: (m: Exporters) => ({ recipeJson: m.recipeJson }),
  safe: (m: Exporters) => ({ safeBatch: m.safeBatch }),
};

export type ExporterKind = keyof typeof PICK;

type Module<K extends ExporterKind> = ReturnType<(typeof PICK)[K]>;

const loaded = new Set<ExporterKind>();

export function loadExporter<K extends ExporterKind>(kind: K): Promise<Module<K>> {
  return import("./exporters/index").then((module) => {
    loaded.add(kind);
    return PICK[kind](module) as Module<K>;
  });
}

/** The exporters asked for so far, in the order they were first asked for. */
export function loadedExporters(): ExporterKind[] {
  return [...loaded];
}

/** @internal Tests: forget which exporters were asked for (the chunk stays cached by the browser). */
export function resetLoadedExporters(): void {
  loaded.clear();
}
