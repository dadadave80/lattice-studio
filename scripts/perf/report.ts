// The performance results table and its fix requests (brief Q4: "a results table in the report; each miss
// becomes a fix request naming the module and the import or render causing it"). Budgets are spec L805-L817's,
// with the first-load gate at the orchestrator's interim 370 KB (QUESTIONS Q19) and the spec's 240 KB kept as the
// target. Pure: run.ts gathers the inputs.
import { BUDGETS, type SizeReport } from "../ci/size-logic.ts";
import type { Composition } from "./composition.ts";
import type { Attribution } from "./profile.ts";
import { median } from "./stats.ts";
import type { AnalysisResult, DragResult, LighthouseResult } from "./types.ts";

export const PERF_BUDGETS = {
  /** Spec L809: the target. */
  firstLoadTarget: 240_000,
  /** QUESTIONS Q19: the CI gate until David picks an option. */
  firstLoadGate: BUDGETS.firstLoadJs,
  /** Spec L815. */
  lcpMs: 2500,
  /** Spec L816. */
  inpMs: 200,
  /** Spec L816's measured figure for what a drag adds per move: a reference, not a budget. */
  dragReferenceMs: 11,
  /** Spec L816's scene. */
  scene: { cards: 30, handles: 450, edges: 30 },
  /** Spec L817, L301. */
  analysisMs: 5,
} as const;

export type Status = "ok" | "over" | "above reference" | "info" | "missing";

export type Row = {
  readonly item: string;
  readonly measured: string;
  readonly budget: string;
  readonly status: Status;
  /** A miss fails the full run. */
  readonly enforced: boolean;
};

export type PerfInputs = {
  readonly smoke: boolean;
  readonly size: SizeReport | null;
  readonly composition: Composition | null;
  readonly lighthouse: LighthouseResult | null;
  readonly drag: DragResult | null;
  readonly analysis: AnalysisResult | null;
  readonly profiles: readonly Attribution[];
};

export type Evaluation = { readonly rows: readonly Row[]; readonly fixes: readonly string[]; readonly ok: boolean };

export const kb = (bytes: number): string => `${(bytes / 1000).toFixed(1)} KB`;
export const ms = (value: number): string => `${value.toFixed(value < 10 ? 2 : value < 100 ? 1 : 0)} ms`;

function top(attribution: Attribution | undefined, count: number): string {
  if (!attribution || attribution.busy <= 0) return "no profile";
  const pct = (v: number): string => `${((v / attribution.busy) * 100).toFixed(0)}%`;
  const files = attribution.bySource.slice(0, count).map((s) => `${s.name} ${pct(s.ms)}`).join(", ");
  const lines = attribution.byLine.slice(0, 4).map((s) => `${s.name} ${pct(s.ms)}`).join(", ");
  return lines ? `${files}; the hottest functions start at ${lines}` : files;
}

/** Rows and fix requests for every budget the inputs cover. `ok` is false when an enforced budget is over. */
export function evaluate(inputs: PerfInputs): Evaluation {
  const rows: Row[] = [];
  const fixes: string[] = [];
  const profile = (label: string): Attribution | undefined => inputs.profiles.find((p) => p.label === label);

  // First load (spec L809, Q19).
  const firstLoad = inputs.size?.rows.find((r) => r.item === "First-load JavaScript")?.gz ?? null;
  if (firstLoad === null) {
    rows.push({ item: "First-load JavaScript", measured: "not measured", budget: kb(PERF_BUDGETS.firstLoadGate), status: "missing", enforced: true });
  } else {
    rows.push({
      item: "First-load JavaScript (CI gate, interim)",
      measured: `${kb(firstLoad)} gz`,
      budget: `${kb(PERF_BUDGETS.firstLoadGate)} gz`,
      status: firstLoad <= PERF_BUDGETS.firstLoadGate ? "ok" : "over",
      enforced: true,
    });
    for (const chunk of inputs.composition?.chunks ?? []) {
      rows.push({ item: `  ${chunk.name}`, measured: `${kb(chunk.gz)} gz`, budget: "", status: "info", enforced: false });
    }
    const overTarget = firstLoad > PERF_BUDGETS.firstLoadTarget;
    rows.push({
      item: "First-load JavaScript (spec target)",
      measured: `${kb(firstLoad)} gz`,
      budget: `${kb(PERF_BUDGETS.firstLoadTarget)} gz`,
      status: overTarget ? "over" : "ok",
      enforced: false,
    });
    const c = inputs.composition;
    if (overTarget && c) {
      const all = c.options.reduce((sum, o) => sum + o.gz, 0);
      const options = c.options.map((o) => `${o.name}: −${kb(o.gz)} (FX15 estimated −${kb(o.fx15)})`).join("; ");
      const groups = c.groups.slice(0, 8).map((g) => `${g.name} ${kb(g.gz)}`).join(", ");
      fixes.push(
        `First load is ${kb(firstLoad)} gz, ${kb(firstLoad - PERF_BUDGETS.firstLoadTarget)} over spec L809's 240 KB ` +
          `(the interim gate, 370 KB, leaves ${kb(PERF_BUDGETS.firstLoadGate - firstLoad)}). To reach 240, move out of the entry chunk: ` +
          `${options}. All three: ${kb(firstLoad - all)}. Largest groups in first load: ${groups}.` +
          (c.matchesRecord ? "" : " (The composition build's chunks differ from the build of record's; sizes are approximate.)"),
      );
    }
  }
  for (const r of inputs.size?.rows ?? []) {
    if (r.item === "First-load JavaScript" || r.item.startsWith("Lazy chunk")) continue;
    rows.push({
      item: r.item,
      measured: r.unit === "gz" ? `${kb(r.gz ?? 0)} gz` : kb(r.raw),
      budget: r.unit === "gz" ? `${kb(r.budget)} gz` : kb(r.budget),
      status: r.ok ? "ok" : r.warnOnly ? "above reference" : "over",
      enforced: false,
    });
  }
  const lazy = (inputs.size?.rows ?? []).filter((r) => r.item.startsWith("Lazy chunk") && !r.warnOnly);
  const largestLazy = lazy.reduce<(typeof lazy)[number] | null>((best, r) => (!best || (r.gz ?? 0) > (best.gz ?? 0) ? r : best), null);
  if (largestLazy) {
    rows.push({
      item: `Largest lazy chunk (${largestLazy.item.replace("Lazy chunk ", "")})`,
      measured: `${kb(largestLazy.gz ?? 0)} gz`,
      budget: `${kb(BUDGETS.lazyChunk)} gz`,
      status: largestLazy.ok ? "ok" : "over",
      enforced: false,
    });
  }

  // Largest Contentful Paint (spec L815).
  const lh = inputs.lighthouse;
  if (!lh || lh.runs === 0) {
    rows.push({ item: "Largest Contentful Paint", measured: "not measured", budget: "2.5 s", status: "missing", enforced: true });
  } else {
    const lcp = median(lh.lcp);
    rows.push({
      item: `Largest Contentful Paint (${lh.formFactor}, median of ${lh.runs})`,
      measured: `${(lcp / 1000).toFixed(2)} s`,
      budget: `${(PERF_BUDGETS.lcpMs / 1000).toFixed(1)} s`,
      status: lcp <= PERF_BUDGETS.lcpMs ? "ok" : "over",
      enforced: true,
    });
    rows.push({ item: "  First Contentful Paint (median)", measured: `${(median(lh.fcp) / 1000).toFixed(2)} s`, budget: "", status: "info", enforced: false });
    rows.push({ item: "  Total Blocking Time (median)", measured: ms(median(lh.tbt)), budget: "", status: "info", enforced: false });
    if (lcp > PERF_BUDGETS.lcpMs) {
      const phases = Object.entries(lh.lcpPhases).map(([k, v]) => `${k} ${ms(v)}`).join(", ");
      const largest = lh.largest.map((r) => `${r.url.replace(/^https?:\/\/[^/]+/, "")} ${kb(r.bytes)}`).join(", ");
      fixes.push(
        `LCP is ${(lcp / 1000).toFixed(2)} s (runs: ${lh.lcp.map((v) => (v / 1000).toFixed(2)).join(", ")} s), over 2.5 s (${lh.throttling}). ` +
          `The LCP element is ${lh.lcpElement ?? "unknown"}; its phases as observed, before simulation: ${phases || "none reported"}. The page makes ` +
          `${lh.requests.count} requests (${kb(lh.requests.bytes)} transferred); the largest: ${largest}.`,
      );
    }
  }

  // Drag and INP (spec L816).
  const drag = inputs.drag;
  if (!drag) {
    rows.push({ item: "Interaction to Next Paint", measured: "not measured", budget: "200 ms", status: "missing", enforced: true });
  } else {
    const worst = drag.interactions.reduce<(typeof drag.interactions)[number] | null>((w, i) => (!w || i.duration > w.duration ? i : w), null);
    const inp = worst?.duration ?? 0;
    rows.push({
      item: `Interaction to Next Paint (${drag.interactions.length} scripted, ${drag.throttle}× CPU)`,
      measured: worst ? `${ms(inp)} (${worst.step})` : "under 16 ms",
      budget: `${PERF_BUDGETS.inpMs} ms`,
      status: inp <= PERF_BUDGETS.inpMs ? "ok" : "over",
      enforced: true,
    });
    if (worst && inp > PERF_BUDGETS.inpMs) {
      fixes.push(
        `INP is ${ms(inp)} at ${drag.throttle}× CPU, over 200 ms: "${worst.step}" (${worst.name} on ${worst.target || "the page"}). ` +
          `The scripted interactions' main-thread time goes to: ${top(profile("interactions"), 6)}.`,
      );
    }
    const added = drag.drag.mean - drag.hover.mean;
    rows.push({
      item: `Drag, added per move (${drag.moves} moves, ${drag.throttle}× CPU)`,
      measured: ms(added),
      budget: `~${PERF_BUDGETS.dragReferenceMs} ms (reference)`,
      status: added <= PERF_BUDGETS.dragReferenceMs ? "ok" : "above reference",
      enforced: false,
    });
    rows.push({
      item: "  Drag, per move (mean · p95)",
      measured: `${ms(drag.drag.mean)} · ${ms(drag.drag.p95)}`,
      budget: "",
      status: "info",
      enforced: false,
    });
    rows.push({ item: "  Hover, per move (mean)", measured: ms(drag.hover.mean), budget: "", status: "info", enforced: false });
    const s = PERF_BUDGETS.scene;
    rows.push({
      item: "  Scene: cards · handles · edges",
      measured: `${drag.scene.cards} · ${drag.scene.handles} · ${drag.scene.edges}`,
      budget: `${s.cards} · ${s.handles} · ${s.edges}`,
      status: "info",
      enforced: false,
    });
    if (added > PERF_BUDGETS.dragReferenceMs) {
      const p = drag.dragParts;
      fixes.push(
        `Dragging adds ${ms(added)} per move at ${drag.throttle}× CPU (drag ${ms(drag.drag.mean)}, hover ${ms(drag.hover.mean)}; per move script ` +
          `${ms(p.script)}, style ${ms(p.style)}, layout ${ms(p.layout)}), against spec L816's ~11 ms. The drag's main-thread time goes to: ` +
          `${top(profile("drag"), 8)}.`,
      );
    }
  }

  // Analysis (spec L301, L817).
  const analysis = inputs.analysis;
  if (!analysis || analysis.cases.length === 0) {
    rows.push({ item: "Analysis, 30 facets", measured: "not measured", budget: "5 ms", status: "missing", enforced: true });
  } else {
    for (const c of analysis.cases) {
      const over = c.stats.median > PERF_BUDGETS.analysisMs;
      rows.push({
        item: `Analysis, ${c.name} (median · p95, ${analysis.throttle}× CPU)`,
        measured: `${ms(c.stats.median)} · ${ms(c.stats.p95)}`,
        budget: `${PERF_BUDGETS.analysisMs} ms`,
        status: over ? "over" : "ok",
        enforced: true,
      });
      if (over) {
        fixes.push(
          `analyze takes ${ms(c.stats.median)} (median of ${c.stats.n}) on ${c.name} (${c.exported} selectors, ${c.problems} problems) at ` +
            `${analysis.throttle}× CPU, over 5 ms. Its time goes to: ${top(profile("analysis"), 8)}.`,
        );
      }
    }
  }

  const ok = inputs.smoke ? rows.every((r) => r.status !== "missing") : rows.every((r) => !r.enforced || r.status === "ok");
  return { rows, fixes, ok };
}

/** The results table, the fix requests, then where each profiled phase's time goes. */
export function renderEvaluation(evaluation: Evaluation, profiles: readonly Attribution[], smoke: boolean): string {
  const lines: string[] = [];
  const w = Math.max(...evaluation.rows.map((r) => r.item.length), 4);
  const mw = Math.max(...evaluation.rows.map((r) => r.measured.length), 8);
  const bw = Math.max(...evaluation.rows.map((r) => r.budget.length), 6);
  lines.push(`${"Item".padEnd(w)}  ${"Measured".padEnd(mw)}  ${"Budget".padEnd(bw)}  Status`);
  for (const r of evaluation.rows) {
    const status = r.status === "info" ? "" : `${r.status}${r.enforced && r.status !== "ok" && !smoke ? " (enforced)" : ""}`;
    lines.push(`${r.item.padEnd(w)}  ${r.measured.padEnd(mw)}  ${r.budget.padEnd(bw)}  ${status}`.trimEnd());
  }
  if (evaluation.fixes.length > 0) {
    lines.push("", "Fix requests:");
    evaluation.fixes.forEach((f, i) => lines.push(`${i + 1}. ${f}`));
  }
  for (const p of profiles) {
    if (p.busy <= 0) continue;
    lines.push("", `Where the ${p.label} time goes (${ms(p.busy)} busy in the profiled pass), by group:`);
    for (const g of p.byGroup.slice(0, 8)) lines.push(`  ${((g.ms / p.busy) * 100).toFixed(0).padStart(3)}%  ${g.name}`);
  }
  return lines.join("\n");
}
