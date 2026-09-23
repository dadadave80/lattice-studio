/**
 * What the service worker leaves out of its precache (spec L814, L830): ELK and WalletConnect load only on an
 * explicit action, so neither their chunks nor anything only they load is precached. Everything else the
 * build emits (every first-party chunk, CSS, fonts) is.
 *
 * Chunk names don't say what's inside, so the build decides from the module graph: a chunk holding a module
 * from an excluded package is a seed, and a chunk or asset is excluded when every chunk that loads it is.
 */
import type { Rolldown } from "vite";

type OutputBundle = Rolldown.OutputBundle;

/** Modules that load only on an explicit action. */
export const LAZY_ONLY_MODULES: readonly RegExp[] = [
  /[\\/]node_modules[\\/]elkjs[\\/]/,
  /[\\/]node_modules[\\/]@walletconnect[\\/]/,
  /[\\/]node_modules[\\/]@reown[\\/]/,
];

/** Emitted files that belong to them though no chunk lists their modules (ELK's worker). */
export const LAZY_ONLY_FILES: readonly RegExp[] = [/(^|\/)elk[^/]*\.js$/i];

export type GraphNode = {
  file: string;
  isEntry: boolean;
  /** Module ids inside a chunk; empty for an asset. */
  moduleIds: readonly string[];
  /** Chunks imported statically. */
  imports: readonly string[];
  /** Chunks imported with `import()`, and assets (CSS, workers) the chunk loads. */
  lazyRefs: readonly string[];
};

export type PrecacheSplit = {
  /** Files the service worker must not precache, sorted. */
  excluded: string[];
  /** Seeds that the entry loads statically: they stay precached, and the build warns. */
  eager: string[];
};

export type ExcludeRules = { modules: readonly RegExp[]; files: readonly RegExp[] };

export const LAZY_ONLY: ExcludeRules = { modules: LAZY_ONLY_MODULES, files: LAZY_ONLY_FILES };

export function splitPrecache(nodes: readonly GraphNode[], rules: ExcludeRules = LAZY_ONLY): PrecacheSplit {
  const byFile = new Map(nodes.map((n) => [n.file, n]));
  const importers = new Map<string, Set<string>>();
  for (const n of nodes) {
    for (const ref of [...n.imports, ...n.lazyRefs]) {
      if (!importers.has(ref)) importers.set(ref, new Set());
      importers.get(ref)?.add(n.file);
    }
  }

  // Everything the entries load before the app runs.
  const startup = new Set<string>();
  const queue = nodes.filter((n) => n.isEntry).map((n) => n.file);
  while (queue.length) {
    const file = queue.pop() as string;
    if (startup.has(file)) continue;
    startup.add(file);
    for (const next of byFile.get(file)?.imports ?? []) queue.push(next);
  }

  const excluded = new Set<string>();
  const eager: string[] = [];
  for (const n of nodes) {
    const seed = n.moduleIds.some((id) => rules.modules.some((r) => r.test(id))) || rules.files.some((r) => r.test(n.file));
    if (!seed) continue;
    if (startup.has(n.file)) eager.push(n.file);
    else excluded.add(n.file);
  }

  let grew = true;
  while (grew) {
    grew = false;
    for (const n of nodes) {
      if (excluded.has(n.file) || startup.has(n.file) || n.isEntry) continue;
      const from = importers.get(n.file);
      if (from && from.size > 0 && [...from].every((f) => excluded.has(f))) {
        excluded.add(n.file);
        grew = true;
      }
    }
  }
  return { excluded: [...excluded].sort(), eager: eager.sort() };
}

/** The bundle as a graph (`generateBundle`). */
export function bundleGraph(bundle: OutputBundle): GraphNode[] {
  return Object.values(bundle).map((item): GraphNode => {
    if (item.type === "asset") return { file: item.fileName, isEntry: false, moduleIds: [], imports: [], lazyRefs: [] };
    const meta = item.viteMetadata;
    return {
      file: item.fileName,
      isEntry: item.isEntry,
      moduleIds: item.moduleIds,
      imports: item.imports,
      lazyRefs: [...item.dynamicImports, ...(meta?.importedCss ?? []), ...(meta?.importedAssets ?? [])],
    };
  });
}

/** The release's own hashed files, for the next release to carry (spec L831). */
export function hashedAssets(bundle: OutputBundle): string[] {
  return Object.keys(bundle).filter((f) => f.startsWith("assets/")).sort();
}

/** Each build's list of its own hashed files, read by the next release's `carry-previous.ts`. */
export const RELEASE_MANIFEST = "release.json";

/** What `release.json` holds. */
export type ReleaseManifest = {
  /** This build's hashed files under `assets/`. */
  assets: string[];
  /** Files the service worker doesn't precache. */
  notPrecached: string[];
  /** The previous release's files copied in by `carry-previous.ts`. */
  carried?: string[];
};
