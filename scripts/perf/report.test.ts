import { describe, expect, test } from "bun:test";
import type { SizeReport } from "../ci/size-logic.ts";
import type { Composition } from "./composition.ts";
import type { Attribution } from "./profile.ts";
import { evaluate, PERF_BUDGETS, renderEvaluation, REPORT_ONLY, type PerfInputs } from "./report.ts";
import type { AnalysisResult, DragResult, LighthouseResult, Stats } from "./types.ts";

const stats = (median: number, mean = median): Stats => ({ n: 10, mean, median, p95: median + 1, min: median - 1, max: median + 2 });

function size(firstLoad: number): SizeReport {
  return {
    ok: true,
    rows: [
      { item: "First-load JavaScript", gz: firstLoad, raw: firstLoad, budget: 255_000, unit: "gz", warnOnly: false, ok: firstLoad <= 255_000 },
      { item: "CSS", gz: 8_900, raw: 8_900, budget: 25_000, unit: "gz", warnOnly: false, ok: true },
      { item: "Catalog index", gz: 81_400, raw: 81_400, budget: 60_000, unit: "gz", warnOnly: true, ok: false },
      { item: "Lazy chunk shiki-x.js", gz: 57_800, raw: 180_000, budget: 70_000, unit: "gz", warnOnly: false, ok: true },
      { item: "Lazy chunk walletconnect-x.js (no budget)", gz: 90_000, raw: 400_000, budget: 70_000, unit: "gz", warnOnly: true, ok: true },
    ],
  };
}

const composition: Composition = {
  total: 252_400,
  chunks: [{ name: "assets/index-a.js", gz: 252_000 }, { name: "assets/runtime-b.js", gz: 400 }],
  groups: [{ name: "react-dom", gz: 54_000 }],
  options: [
    { name: "Lazy-load the sheet (React Flow, d3, the card)", fx15: 65_000, gz: 1_000 },
    { name: "Lazy analysis and the document commands", fx15: 26_000, gz: 14_000 },
    { name: "Lazy Base UI popups", fx15: 30_000, gz: 2_000 },
  ],
  matchesRecord: true,
};

const lighthouse = (lcp: number): LighthouseResult => ({
  runs: 3,
  lcp: [lcp, lcp + 10, lcp - 10],
  fcp: [900, 900, 900],
  tbt: [100, 100, 100],
  lcpElement: '"A diamond only your Safe can upgrade" (span)',
  lcpPhases: { "Element render delay": 800 },
  requests: { count: 63, bytes: 1_131_000 },
  largest: [{ url: "http://localhost:1/catalog/dev/index.json", bytes: 429_300 }],
  formFactor: "mobile",
  throttling: "simulate, 4× CPU, 150 ms RTT, 1638 Kbps",
});

const drag = (worst: number): DragResult => ({
  throttle: 4,
  scene: { cards: 30, handles: 428, edges: 52 },
  moves: 96,
  drag: stats(55, 57.6),
  hover: stats(5, 6),
  dragParts: { script: 29.5, style: 2, layout: 1.9 },
  interactions: [
    { step: "Drag a card", name: "pointerup", target: "div card X", duration: 64 },
    { step: "Undo", name: "keydown", target: "div group", duration: worst },
  ],
  profiles: [],
});

const analysis = (median: number): AnalysisResult => ({
  throttle: 4,
  cases: [{ name: "30 colliding cards", facets: 30, exported: 211, problems: 70, stats: stats(median) }],
  profiles: [],
});

const profiles: Attribution[] = [
  {
    label: "analysis",
    busy: 100,
    bySource: [{ name: "packages/core/src/analysis/analyze.ts", ms: 34 }],
    byGroup: [{ name: "core/analysis", ms: 55 }],
    byLine: [{ name: "packages/core/src/analysis/analyze.ts:105", ms: 20 }],
  },
];

function inputs(over: Partial<PerfInputs> = {}): PerfInputs {
  return {
    smoke: false,
    size: size(252_400),
    composition,
    lighthouse: lighthouse(2000),
    drag: drag(150),
    analysis: analysis(4),
    profiles,
    ...over,
  };
}

describe("evaluate", () => {
  test("every enforced budget met: ok, though first load is over the spec's target and the drag above its reference", () => {
    const e = evaluate(inputs());
    expect(e.ok).toBe(true);
    expect(e.rows.find((r) => r.item === "First-load JavaScript (CI gate)")?.status).toBe("ok");
    const target = e.rows.find((r) => r.item === "First-load JavaScript (spec target)");
    expect(target).toMatchObject({ status: "over", enforced: false, budget: "240.0 KB gz" });
    expect(e.rows.find((r) => r.item.startsWith("Drag, added per move"))).toMatchObject({ measured: "51.6 ms", status: "above reference", enforced: false });
    expect(e.rows.find((r) => r.item.startsWith("Largest lazy chunk"))?.item).toBe("Largest lazy chunk (shiki-x.js)");
    expect(e.rows.find((r) => r.item === "Catalog index")?.status).toBe("warn");
  });

  test("the first-load fix request names each Q19 option with its measured size and what all three leave", () => {
    const fix = evaluate(inputs()).fixes[0] ?? "";
    expect(fix).toContain("12.4 KB over spec L809's 240 KB (the gate, 255.0 KB, leaves 2.6 KB)");
    expect(fix).toContain("Lazy-load the sheet (React Flow, d3, the card): −1.0 KB (FX15 estimated −65.0 KB)");
    expect(fix).toContain("All three: 235.4 KB");
  });

  test("with no row report-only, LCP, INP and analysis over their budgets fail the full run, each with a fix request", () => {
    const e = evaluate(inputs({ lighthouse: lighthouse(7900), drag: drag(232), analysis: analysis(6.7) }), {});
    expect(e.ok).toBe(false);
    const over = e.rows.filter((r) => r.enforced && r.status === "over").map((r) => r.item);
    expect(over).toHaveLength(3);
    expect(e.fixes.some((f) => f.startsWith("LCP is 7.90 s") && f.includes("/catalog/dev/index.json 429.3 KB"))).toBe(true);
    expect(e.fixes.some((f) => f.startsWith('INP is 232 ms at 4× CPU, over 200 ms: "Undo" (keydown on div group)'))).toBe(true);
    expect(e.fixes.some((f) => f.includes("analysis/analyze.ts 34%") && f.includes("analyze.ts:105 20%"))).toBe(true);
  });

  test("the ruling: LCP report-only until Q19, INP until the Undo fix, the drag row names Q19, the rest (analysis since FX29) enforced", () => {
    expect(REPORT_ONLY).toEqual({ lcp: "Q19", drag: "Q19", inp: "the Undo fix" });
    const e = evaluate(inputs({ lighthouse: lighthouse(7900) }));
    expect(e.ok).toBe(true);
    expect(e.rows.find((r) => r.item.startsWith("Largest Contentful Paint"))).toMatchObject({ status: "over", enforced: false, until: "Q19" });
    const slow = evaluate(inputs({ analysis: analysis(6.7) }));
    expect(slow.rows.find((r) => r.item.startsWith("Analysis, 30 colliding"))).toMatchObject({ status: "over", enforced: true });
    expect(slow.ok).toBe(false);
    expect(e.rows.find((r) => r.item.startsWith("Drag, added per move"))).toMatchObject({ enforced: false, until: "Q19" });
    expect(e.fixes.some((f) => f.startsWith("LCP is 7.90 s"))).toBe(true);
    // INP over is reported, not failed; the first-load gate still fails the run.
    const sluggish = evaluate(inputs({ drag: drag(232) }));
    expect(sluggish.ok).toBe(true);
    expect(sluggish.rows.find((r) => r.item.startsWith("Interaction to Next Paint"))).toMatchObject({ status: "over", enforced: false, until: "the Undo fix" });
    expect(evaluate(inputs({ size: size(380_000) })).ok).toBe(false);
    const text = renderEvaluation(e, [], false);
    expect(text).toMatch(/Largest Contentful Paint \(mobile, median of 3\)\s+7\.90 s\s+2\.5 s\s+over \(report-only until Q19\)/);
  });

  test("smoke never fails on a budget, only on a missing measurement", () => {
    expect(evaluate(inputs({ smoke: true, lighthouse: lighthouse(7900), analysis: analysis(9) })).ok).toBe(true);
    const missing = evaluate(inputs({ smoke: true, drag: null }));
    expect(missing.ok).toBe(false);
    expect(missing.rows.find((r) => r.status === "missing")?.item).toBe("Interaction to Next Paint");
  });

  test("an INP under the Event Timing floor reads as such", () => {
    const e = evaluate(inputs({ drag: { ...drag(0), interactions: [] } }));
    expect(e.rows.find((r) => r.item.startsWith("Interaction to Next Paint"))?.measured).toBe("under 16 ms");
  });
});

describe("renderEvaluation", () => {
  test("a table with a header, enforced misses marked, fix requests numbered, and each profile's groups", () => {
    const e = evaluate(inputs({ lighthouse: lighthouse(7900) }), {});
    const text = renderEvaluation(e, profiles, false);
    expect(text.split("\n")[0]).toMatch(/^Item\s+Measured\s+Budget\s+Status$/);
    expect(text).toMatch(/Largest Contentful Paint \(mobile, median of 3\)\s+7\.90 s\s+2\.5 s\s+over \(enforced\)/);
    expect(text).toContain("Fix requests:\n1. First load is");
    expect(text).toContain("Where the analysis time goes (100 ms busy in the profiled pass), by group:\n   55%  core/analysis");
  });
  test("PERF_BUDGETS keep the spec's numbers and the gate", () => {
    expect(PERF_BUDGETS).toMatchObject({ firstLoadTarget: 240_000, firstLoadGate: 255_000, lcpMs: 2500, inpMs: 200, analysisMs: 5 });
  });
});
