/**
 * The analysis of the open document (contracts §5.1 `useAnalysis`, spec L296-L305) and its narration.
 *
 * `getAnalysis()` is memoized on the recipe hash, the catalog hash and a digest of the context, so an edit
 * that leaves the recipe as it was (a drag, a record, an undo back to an equal recipe) returns the same object
 * and re-renders nothing. The inputs are compared by identity first, so reading it in render stays cheap.
 *
 * Core's `analyze` and `narrate` load in their own chunk (`analyzer.ts`), asked for when the engine starts: until
 * they arrive the analysis is empty, as it is while the catalog loads, and their arrival resets narration's
 * baseline like a new catalog does, so nothing already on the sheet is narrated as new.
 *
 * Narration: the console reports the difference between the previous and the new analysis (C10 `narrate`).
 * It runs in a microtask after the change, or at once when a command calls `flush()`, so a command's own line
 * ("Placed ERC20 · 9 selectors · …") comes first and the new problems follow it (spec L428). Loading a project
 * or a recipe, and a new catalog, reset the baseline: nothing narrates against the old sheet (spec L304).
 * A command whose effect narrates nothing (layout, a default owner moved) queues a fallback line, logged only
 * when narration had nothing to say, so no edit is ever silent.
 */
import type {
  analyze as coreAnalyze, Analysis, AnalysisContext, Catalog, Hex, LineDraft, NarrateCause, narrate as coreNarrate, Project,
  Recipe,
} from "@lattice-studio/core";
import { canonicalJson, isNotImplemented, recipeHash } from "@lattice-studio/core";
import {
  doc, emptyAnalysis, getCatalog, log, session, subscribeCatalog, type AnalysisProvider,
} from "@/contracts";
import { loadAnalyzer, loadedAnalyzer, onAnalyzerLoaded } from "./analyzer";
import type { ChainMirror } from "./chain-mirror";
import { buildContext } from "./context";
import type { DeploymentsMirror } from "./deployments-mirror";
import type { PredictionMirror } from "./prediction";

export type AnalysisEngineDeps = {
  chain: ChainMirror;
  deployments: DeploymentsMirror;
  prediction: PredictionMirror;
  /** Core's `analyze`, loaded with `analyzer.ts` unless given; tests inject fakes, or core's own to run at once. */
  analyze?: typeof coreAnalyze;
  narrate?: typeof coreNarrate;
};

export type AnalysisEngine = {
  provider: AnalysisProvider;
  /** The analysis context of the open document now. */
  context(): AnalysisContext;
  /** Logs `line` in the next flush, before narration. */
  say(line: LineDraft): void;
  /** Logs `line` in the next flush only if narration has nothing to say. */
  fallback(line: LineDraft): void;
  /** The next flush narrates nothing: the analysis it finds becomes the baseline (a recipe load). */
  resetBaseline(): void;
  /** Narrates now: queued lines, the difference since the last flush, then fallbacks. */
  flush(): void;
  /** Starts the subscriptions narration needs; returns a disposer. Idempotent. */
  start(): () => void;
};

const EMPTY = emptyAnalysis();

type Memo = {
  recipe: Recipe;
  catalog: Catalog;
  context: AnalysisContext;
  key: string;
  analysis: Analysis;
};

type ContextMemo = {
  predicted: Project["predicted"];
  provenance: Project["provenance"];
  prediction: unknown;
  account: unknown;
  deployments: unknown;
  chain: unknown;
  context: AnalysisContext;
};

function digest(value: unknown): string {
  try {
    return canonicalJson(value);
  } catch {
    return JSON.stringify(value);
  }
}

export function createAnalysisEngine(deps: AnalysisEngineDeps): AnalysisEngine {
  const analyzeFn = () => deps.analyze ?? loadedAnalyzer()?.analyze;
  const narrateFn = () => deps.narrate ?? loadedAnalyzer()?.narrate;
  let memo: Memo | null = null;
  let contextMemo: ContextMemo | null = null;
  /** Messages already logged for analysis failures, so a failing analysis logs once, not per render. */
  const failures = new Set<string>();

  const context = (): AnalysisContext => {
    const project = doc.get();
    const chainId = session.get().chainId;
    const prediction = deps.prediction.get();
    const account = deps.chain.account();
    const deployments = deps.deployments.list();
    const chain = chainId === null ? undefined : deps.chain.chainState(chainId);
    const m = contextMemo;
    if (
      m && m.predicted === project.predicted && m.provenance === project.provenance && m.prediction === prediction
      && m.account === account && m.deployments === deployments && m.chain === chain
    ) return m.context;
    const built = buildContext({
      project, prediction, account, deployments, chain, chainName: (id) => deps.chain.chainName(id),
    });
    // Equal contexts keep one identity, so the analysis memo's fast path holds.
    const next = m && digest(m.context) === digest(built) ? m.context : built;
    contextMemo = {
      predicted: project.predicted, provenance: project.provenance, prediction, account, deployments, chain, context: next,
    };
    return next;
  };

  const fail = (error: unknown): Analysis => {
    const text = isNotImplemented(error)
      ? `Analysis not built yet · WP-${error.wp}`
      : `Analysis failed: ${error instanceof Error ? error.message : String(error)}`;
    if (!failures.has(text)) {
      failures.add(text);
      log({ tag: isNotImplemented(error) ? "Note" : "Error", text });
      if (!isNotImplemented(error)) console.error(error);
    }
    return EMPTY;
  };

  const getAnalysis = (): Analysis => {
    const catalog = getCatalog();
    if (!catalog) return EMPTY;
    const analyze = analyzeFn();
    if (!analyze) {
      void loadAnalyzer().catch(() => undefined);
      return EMPTY;
    }
    const { recipe } = doc.get();
    const ctx = context();
    if (memo && memo.recipe === recipe && memo.catalog === catalog && memo.context === ctx) return memo.analysis;
    let hash: Hex | string;
    try {
      hash = recipeHash(recipe, catalog);
    } catch (error) {
      if (!isNotImplemented(error)) return fail(error);
      hash = digest(recipe);
    }
    const key = `${hash}|${catalog.hash}|${digest(ctx)}`;
    if (memo && memo.key === key) {
      memo = { ...memo, recipe, catalog, context: ctx };
      return memo.analysis;
    }
    let analysis: Analysis;
    try {
      analysis = analyze(recipe, catalog, ctx);
    } catch (error) {
      analysis = fail(error);
    }
    memo = { recipe, catalog, context: ctx, key, analysis };
    return analysis;
  };

  const subscribeInputs = (listener: () => void): (() => void) => {
    const stops = [
      doc.subscribe((state, previous) => {
        const a = state.project;
        const b = previous.project;
        if (a.recipe !== b.recipe || a.predicted !== b.predicted || a.provenance !== b.provenance) listener();
      }),
      session.subscribe((state, previous) => {
        if (state.chainId !== previous.chainId) listener();
      }),
      subscribeCatalog(() => listener()),
      onAnalyzerLoaded(listener),
      deps.chain.subscribe(listener),
      deps.deployments.subscribe(listener),
      deps.prediction.subscribe(listener),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  };

  const provider: AnalysisProvider = {
    getAnalysis,
    subscribe(listener) {
      return subscribeInputs(listener);
    },
  };

  // ── Narration ──────────────────────────────────────────────────────────────────────────────────────

  /** The analysis the console last narrated against; undefined until the first flush sets it. */
  let baseline: Analysis | undefined;
  let reset = false;
  let cause: NarrateCause | undefined;
  let before: LineDraft[] = [];
  let fallbacks: LineDraft[] = [];
  let scheduled = false;
  let started = false;

  const flush = (): void => {
    scheduled = false;
    const next = getAnalysis();
    const say = before;
    const otherwise = fallbacks;
    const why = cause;
    const resetting = reset;
    before = [];
    fallbacks = [];
    cause = undefined;
    reset = false;

    for (const line of say) log(line);
    let narrated: LineDraft[] = [];
    if (resetting || baseline === undefined) {
      baseline = next;
    } else if (next !== baseline) {
      const narrate = narrateFn();
      try {
        narrated = narrate ? narrate(baseline, next, why) : [];
      } catch (error) {
        if (!isNotImplemented(error)) throw error;
        fail(error);
      }
      baseline = next;
    }
    for (const line of narrated) log(line);
    if (narrated.length === 0) for (const line of otherwise) log(line);
  };

  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      if (scheduled) flush();
    });
  };

  const start = (): (() => void) => {
    if (started) return () => {};
    started = true;
    if (!deps.analyze || !deps.narrate) void loadAnalyzer().catch(() => undefined);
    const stopPrediction = deps.prediction.start();
    const stopChain = deps.chain.start();
    const stopDeployments = deps.deployments.start();
    const stops = [
      doc.subscribe((state, previous) => {
        const change = state.lastChange;
        if (!change || change === previous.lastChange) return;
        if (change.kind === "load") reset = true;
        else if (change.kind === "undo" || change.kind === "redo") cause = { kind: change.kind, label: change.label };
        else if (change.kind !== "record") cause = { kind: "edit", label: change.label };
        schedule();
      }),
      subscribeCatalog(() => {
        reset = true;
        schedule();
      }),
      onAnalyzerLoaded(() => {
        reset = true;
        schedule();
      }),
      subscribeInputs(() => {
        cause ??= { kind: "chain" };
        schedule();
      }),
    ];
    // The first baseline: what's open when narration starts.
    baseline = getAnalysis();
    return () => {
      started = false;
      scheduled = false;
      for (const stop of stops) stop();
      stopDeployments();
      stopChain();
      stopPrediction();
    };
  };

  return {
    provider,
    context,
    say(line) {
      before.push(line);
      schedule();
    },
    fallback(line) {
      fallbacks.push(line);
      schedule();
    },
    resetBaseline() {
      reset = true;
      schedule();
    },
    flush,
    start,
  };
}
