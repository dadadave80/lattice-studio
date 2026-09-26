// Lighthouse CI results (brief Q4; spec L815: LCP ≤ 2.5 s on the mobile lab profile). Reads the Lighthouse
// reports `lhci collect` saved and keeps what the budget and its fix request need. Pure: run.ts reads the files.
import type { LighthouseResult } from "./types.ts";

type Audit = { numericValue?: number; details?: unknown };
/** The slice of a Lighthouse result (LHR) this reads. */
export type Lhr = {
  readonly audits: Readonly<Record<string, Audit | undefined>>;
  readonly configSettings?: { formFactor?: string; throttlingMethod?: string; throttling?: { cpuSlowdownMultiplier?: number; rttMs?: number; throughputKbps?: number } };
};

type Item = Record<string, unknown>;

function items(details: unknown): Item[] {
  if (details === null || typeof details !== "object") return [];
  const list = (details as { items?: unknown }).items;
  return Array.isArray(list) ? (list.filter((i) => i !== null && typeof i === "object") as Item[]) : [];
}

function num(lhr: Lhr, audit: string): number {
  return lhr.audits[audit]?.numericValue ?? Number.NaN;
}

/** The LCP element's label and its phases, from Lighthouse 12's `lcp-phases-insight` (a list: phases, node). */
function lcpDetails(lhr: Lhr): { element: string | null; phases: Record<string, number> } {
  const phases: Record<string, number> = {};
  let element: string | null = null;
  for (const part of items(lhr.audits["lcp-phases-insight"]?.details)) {
    if (part.type === "table") {
      for (const row of items(part)) if (typeof row.label === "string" && typeof row.duration === "number") phases[row.label] = row.duration;
    } else if (part.type === "node") {
      const label = typeof part.nodeLabel === "string" ? part.nodeLabel : "";
      const selector = typeof part.selector === "string" ? part.selector : "";
      element = [label && `"${label}"`, selector && `(${selector})`].filter(Boolean).join(" ") || null;
    }
  }
  return { element, phases };
}

/** Each run's LCP, FCP and TBT, and the last run's LCP element and phases. */
export function summarizeLighthouse(runs: readonly Lhr[]): LighthouseResult {
  const last = runs[runs.length - 1];
  const details = last ? lcpDetails(last) : { element: null, phases: {} };
  const s = last?.configSettings;
  const t = s?.throttling;
  return {
    runs: runs.length,
    lcp: runs.map((r) => num(r, "largest-contentful-paint")),
    fcp: runs.map((r) => num(r, "first-contentful-paint")),
    tbt: runs.map((r) => num(r, "total-blocking-time")),
    lcpElement: details.element,
    lcpPhases: details.phases,
    requests: last ? requestTotals(last) : { count: 0, bytes: 0 },
    largest: last ? largestRequests(last) : [],
    formFactor: s?.formFactor ?? "unknown",
    throttling: t
      ? `${s?.throttlingMethod ?? "?"}, ${t.cpuSlowdownMultiplier ?? "?"}× CPU, ${t.rttMs ?? "?"} ms RTT, ${Math.round(t.throughputKbps ?? 0)} Kbps`
      : (s?.throttlingMethod ?? "unknown"),
  };
}

/** The largest transfers a run made, biggest first: what the page waited for. */
export function largestRequests(lhr: Lhr, count = 5): { url: string; bytes: number }[] {
  return items(lhr.audits["network-requests"]?.details)
    .map((i) => ({ url: typeof i.url === "string" ? i.url : "", bytes: typeof i.transferSize === "number" ? i.transferSize : 0 }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, count);
}

/** How many requests the run made, and their transfer total in bytes. */
export function requestTotals(lhr: Lhr): { count: number; bytes: number } {
  const all = items(lhr.audits["network-requests"]?.details);
  return { count: all.length, bytes: all.reduce((sum, i) => sum + (typeof i.transferSize === "number" ? i.transferSize : 0), 0) };
}
