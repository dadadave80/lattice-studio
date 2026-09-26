// First-load composition and the Q19 options (brief Q4, orchestrator's notes; QUESTIONS Q19): which packages and
// app areas sit in the first-load chunks, sized in gzip bytes, and how much each lazy-loading option FX15 proposed
// would take out of first load as the build stands. Pure: the composition build (apps/studio/test/perf) supplies
// the modules; run.ts supplies the build of record's measured gzip sizes.
import type { ChunkSize, CompositionResult } from "./types.ts";

/**
 * The group a module belongs to: a package (`react-dom`, `@xyflow/react`), Base UI by part
 * (`@base-ui/react/menu`), core by folder (`core/checks`), the app by area (`app/state`, `app/sheet/card`).
 */
export function groupOf(id: string): string {
  const nm = id.lastIndexOf("node_modules/");
  if (nm >= 0) {
    const parts = id.slice(nm + "node_modules/".length).split("/");
    const pkg = parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1] ?? ""}` : (parts[0] ?? "");
    if (pkg === "@base-ui/react") {
      // @base-ui/react/esm/<part>/…
      const part = parts[2] === "esm" || parts[2] === "cjs" ? parts[3] : parts[2];
      return part && !part.includes(".") ? `${pkg}/${part}` : pkg;
    }
    return pkg;
  }
  const core = /^packages\/core\/src\/([^/]+)/.exec(id);
  if (core) return `core/${core[1]?.replace(/\.tsx?$/, "")}`;
  const app = /^apps\/studio\/src\/([^/]+)(?:\/([^/]+)\/)?/.exec(id);
  if (app) {
    const area = app[1]?.replace(/\.tsx?$/, "") ?? "";
    return ["sheet", "ui", "panels", "chain"].includes(area) && app[2] ? `app/${area}/${app[2]}` : `app/${area}`;
  }
  const pkg = /^packages\/([^/]+)\//.exec(id);
  if (pkg) return `${pkg[1]}`;
  return "other";
}

/** A Q19 option: which modules it would move out of first load. */
export type LazyOption = { readonly name: string; readonly fx15: number; readonly matches: (id: string) => boolean };

/** Base UI parts that only open on demand: menus, context menus, tooltips, popovers and their positioning. */
const POPUP_PARTS = /node_modules\/@base-ui\/react\/(?:esm\/)?(?:menu|context-menu|menubar|tooltip|popover|dialog|alert-dialog|select|combobox|autocomplete|preview-card|navigation-menu|toast|floating-ui-react|utils\/popups|utils\/usePositioner|utils\/FloatingPortalLite|internals\/useAnchorPositioning)/;

/** QUESTIONS Q19's options, each with FX15's estimate in bytes and the modules it covers here. */
export const Q19_OPTIONS: readonly LazyOption[] = [
  {
    name: "Lazy-load the sheet (React Flow, d3, the card)",
    fx15: 65_000,
    matches: (id) => /node_modules\/(?:@xyflow\/|d3-)/.test(id) || id.startsWith("apps/studio/src/sheet/"),
  },
  {
    name: "Lazy analysis and the document commands",
    fx15: 26_000,
    matches: (id) =>
      /^packages\/core\/src\/(?:analysis|checks|init|authority)\//.test(id) ||
      id === "apps/studio/src/state/analysis-engine.ts" ||
      id.startsWith("apps/studio/src/state/cmd/"),
  },
  {
    name: "Lazy Base UI popups",
    fx15: 30_000,
    matches: (id) => POPUP_PARTS.test(id) || /node_modules\/@floating-ui\//.test(id),
  },
];

export type Sized = { readonly name: string; readonly gz: number };

export type Composition = {
  /** First-load gzip bytes, from the build of record where given. */
  readonly total: number;
  /** Each first-load chunk: file, gzip bytes. */
  readonly chunks: readonly Sized[];
  /** Groups, largest first. */
  readonly groups: readonly Sized[];
  /** Each Q19 option's share of first load, and FX15's estimate for it. */
  readonly options: readonly (Sized & { readonly fx15: number })[];
  /** Whether the composition describes the build of record (same entry, every chunk found). */
  readonly matchesRecord: boolean;
};

/**
 * Sizes each module as its chunk's share: the chunk's gzip size (the build of record's, when `recordGz` has it)
 * split in proportion to each module's own gzip size. Gzip isn't additive, so this is an estimate per module;
 * the chunk totals are exact.
 */
export function compose(result: CompositionResult, recordGz: ReadonlyMap<string, number> = new Map()): Composition {
  const first = new Set(result.firstLoad);
  const chunks = result.chunks.filter((c) => first.has(c.file));
  const shares: { id: string; gz: number }[] = [];
  const chunkSizes: Sized[] = [];
  for (const chunk of chunks) {
    const gz = recordGz.get(chunk.file) ?? chunk.gz;
    chunkSizes.push({ name: chunk.file, gz });
    shares.push(...moduleShares(chunk, gz));
  }
  const total = chunkSizes.reduce((sum, c) => sum + c.gz, 0);
  const groups = new Map<string, number>();
  for (const s of shares) groups.set(groupOf(s.id), (groups.get(groupOf(s.id)) ?? 0) + s.gz);
  const options = Q19_OPTIONS.map((o) => ({
    name: o.name,
    fx15: o.fx15,
    gz: shares.filter((s) => o.matches(s.id)).reduce((sum, s) => sum + s.gz, 0),
  }));
  return {
    total,
    chunks: chunkSizes,
    groups: [...groups].map(([name, gz]) => ({ name, gz })).sort((a, b) => b.gz - a.gz),
    options,
    matchesRecord: result.recordEntryFile === result.entryFile && result.unmatched.length === 0,
  };
}

function moduleShares(chunk: ChunkSize, gz: number): { id: string; gz: number }[] {
  const sum = chunk.modules.reduce((s, m) => s + m.gz, 0);
  if (sum === 0) return [{ id: chunk.file, gz }];
  return chunk.modules.map((m) => ({ id: m.id, gz: (m.gz / sum) * gz }));
}
