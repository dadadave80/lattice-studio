// The files the performance benchmarks write and `bun scripts/perf/run.ts` reads (brief Q4). The Playwright side
// (apps/studio/test/perf/, under Node) writes one JSON file per benchmark into the run's output folder; run.ts
// evaluates them against the budgets. Plain types only, so both tsconfigs (scripts: no DOM; the app: DOM) accept them.

/** Summary statistics of a sample, in its unit (ms unless named otherwise). */
export type Stats = {
  readonly n: number;
  readonly mean: number;
  readonly median: number;
  readonly p95: number;
  readonly min: number;
  readonly max: number;
};

/** One module inside a chunk: its rendered length and the gzip size of its code on its own. */
export type ModuleSize = { readonly id: string; readonly rendered: number; readonly gz: number };

/** One JavaScript chunk of the observed build. */
export type ChunkSize = {
  readonly file: string;
  readonly isEntry: boolean;
  /** Static imports (file names), which the browser fetches before the chunk runs. */
  readonly imports: readonly string[];
  readonly raw: number;
  /** gzip size of the chunk as written. */
  readonly gz: number;
  /** Only for first-load chunks; empty for the rest. */
  readonly modules: readonly ModuleSize[];
};

/** `composition.json`: what sits in first load, from a second build of the same config with an observer plugin. */
export type CompositionResult = {
  /** The entry chunk the observer build wrote. */
  readonly entryFile: string;
  /** The entry chunk `apps/studio/dist/index.html` (the build of record) references, if there is one. */
  readonly recordEntryFile: string | null;
  /** First-load JavaScript files, as the observer build's index.html references them (entry and modulepreloads). */
  readonly firstLoad: readonly string[];
  /** Chunks the observer build wrote that the build of record doesn't have (content differs); empty when they agree. */
  readonly unmatched: readonly string[];
  readonly chunks: readonly ChunkSize[];
};

/** What the drag benchmark drew. */
export type Scene = { readonly cards: number; readonly handles: number; readonly edges: number };

/** One Event Timing interaction (the longest entry of its `interactionId`), and the scripted step it belongs to. */
export type Interaction = { readonly step: string; readonly name: string; readonly target: string; readonly duration: number };

/** Self time in one function of a CPU profile (a production chunk's position; run.ts maps it to a source). */
export type ProfileFrame = { readonly url: string; readonly line: number; readonly column: number; readonly fn: string; readonly self: number };

/** A CPU profile of one phase, taken in a separate pass (profiling slows the page, so it never overlaps a measurement). */
export type Profile = { readonly label: string; readonly total: number; readonly frames: readonly ProfileFrame[] };

/** `drag.json`. */
export type DragResult = {
  readonly throttle: number;
  readonly scene: Scene;
  readonly moves: number;
  /** Renderer main-thread time per move (CDP `TaskDuration`), the button held. */
  readonly drag: Stats;
  /** The same path with the button up. */
  readonly hover: Stats;
  /** Of `drag`'s mean: script, style and layout time per move (CDP `ScriptDuration`, `RecalcStyleDuration`, `LayoutDuration`). */
  readonly dragParts: { readonly script: number; readonly style: number; readonly layout: number };
  /** Scripted interactions, each its longest Event Timing entry; INP is the longest of them (fewer than 50). */
  readonly interactions: readonly Interaction[];
  readonly profiles: readonly Profile[];
};

/** One recipe timed by the analysis benchmark. */
export type AnalysisCase = {
  readonly name: string;
  readonly facets: number;
  readonly exported: number;
  readonly problems: number;
  readonly stats: Stats;
};

/** `analysis.json`. */
export type AnalysisResult = { readonly throttle: number; readonly cases: readonly AnalysisCase[]; readonly profiles: readonly Profile[] };

/** The Lighthouse runs, summarized. */
export type LighthouseResult = {
  readonly runs: number;
  readonly lcp: readonly number[];
  readonly fcp: readonly number[];
  readonly tbt: readonly number[];
  /** The last run's LCP element (its label) and its phases, in ms. */
  readonly lcpElement: string | null;
  readonly lcpPhases: Readonly<Record<string, number>>;
  /** The last run's requests (count, transfer bytes) and its largest transfers. */
  readonly requests: { readonly count: number; readonly bytes: number };
  readonly largest: readonly { readonly url: string; readonly bytes: number }[];
  readonly formFactor: string;
  readonly throttling: string;
};
