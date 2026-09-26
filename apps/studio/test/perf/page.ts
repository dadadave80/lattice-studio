/**
 * Page plumbing the benchmarks share (brief Q4): CPU throttling and the renderer's own timing counters through the
 * Chrome DevTools Protocol, an Event Timing recorder that starts before the app's first script, and waiting for a
 * frame. Playwright runs this under Node: nothing here may use Bun's APIs.
 */
import type { CDPSession, Page } from "@playwright/test";
import type { Interaction, Profile, ProfileFrame } from "../../../../scripts/perf/types.ts";
import { CPU_THROTTLE } from "./env.ts";

/** A CDP session on `page` with the CPU slowed `rate` times (spec L803) and the renderer's counters on. */
export async function throttled(page: Page, rate: number = CPU_THROTTLE): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  // Wall-clock ticks: throttling suspends the thread, and only wall time shows the slowdown (thread ticks don't).
  await cdp.send("Performance.enable", { timeDomain: "timeTicks" });
  return cdp;
}

/** The renderer main thread's cumulative counters, in ms: every task, and the script, style and layout inside them. */
export type Counters = { task: number; script: number; style: number; layout: number };

export async function counters(cdp: CDPSession): Promise<Counters> {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const of = (name: string): number => (metrics.find((m) => m.name === name)?.value ?? 0) * 1000;
  return { task: of("TaskDuration"), script: of("ScriptDuration"), style: of("RecalcStyleDuration"), layout: of("LayoutDuration") };
}

export function minus(a: Counters, b: Counters): Counters {
  return { task: a.task - b.task, script: a.script - b.script, style: a.style - b.style, layout: a.layout - b.layout };
}

/** Resolves after the page has produced two more frames, so the work a move scheduled has run and painted. */
export async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
}

type Recorded = { name: string; duration: number; interactionId: number; startTime: number; target: string };
type Recorder = { __perfEvents?: Recorded[]; __perfFrom?: number };

/**
 * Records Event Timing entries (16 ms and longer, the API's floor) from the first script on, in every document the
 * page opens. `pointermove` isn't an Event Timing type, so a drag's moves never show here; its press and release do.
 */
export async function recordInteractions(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = window as unknown as Recorder;
    store.__perfEvents = [];
    const describe = (node: Node | null): string => {
      if (!(node instanceof Element)) return "";
      const facet = node.closest("[data-facet]")?.getAttribute("data-facet");
      const label = node.getAttribute("aria-label") ?? node.getAttribute("role") ?? "";
      return [node.tagName.toLowerCase(), facet ? `card ${facet}` : "", label].filter(Boolean).join(" ");
    };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        store.__perfEvents?.push({
          name: entry.name,
          duration: entry.duration,
          interactionId: entry.interactionId ?? 0,
          startTime: entry.startTime,
          target: describe(entry.target),
        });
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
  });
}

/** Scripted steps and when each began (the page's clock), so an interaction can be named after its step. */
export type Steps = { label: string; at: number }[];

/** Marks the start of scripted step `label`: interactions that start from here on belong to it. */
export async function step(page: Page, steps: Steps, label: string): Promise<void> {
  steps.push({ label, at: await page.evaluate(() => performance.now()) });
}

/**
 * The interactions recorded since the first step, each the longest entry of its `interactionId` (that's the
 * interaction's latency, as INP counts it), named after its step. Waits for two frames and a moment first:
 * entries arrive after the paint.
 */
export async function interactions(page: Page, steps: Steps): Promise<Interaction[]> {
  await nextFrames(page);
  await page.waitForTimeout(250);
  const from = steps[0]?.at ?? 0;
  const entries = await page.evaluate(
    (since) => ((window as unknown as Recorder).__perfEvents ?? []).filter((e) => e.startTime >= since && e.interactionId > 0),
    from,
  );
  const longest = new Map<number, Recorded>();
  for (const entry of entries) {
    const seen = longest.get(entry.interactionId);
    if (!seen || entry.duration > seen.duration) longest.set(entry.interactionId, entry);
  }
  const stepOf = (t: number): string => [...steps].reverse().find((s) => s.at <= t)?.label ?? "";
  return [...longest.values()]
    .sort((a, b) => a.startTime - b.startTime)
    .map((e) => ({ step: stepOf(e.startTime), name: e.name, target: e.target, duration: e.duration }));
}

type ProfileNode = { id: number; callFrame: { url: string; lineNumber: number; columnNumber: number; functionName: string } };

/** Runs `body` under the V8 sampling profiler and returns each function's self time, longest first. */
export async function profile(cdp: CDPSession, label: string, body: () => Promise<void>): Promise<Profile> {
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  try {
    await body();
  } catch (error) {
    // Stop before rethrowing, so nothing after it runs with the profiler on.
    await cdp.send("Profiler.stop");
    await cdp.send("Profiler.disable");
    throw error;
  }
  const { profile: p } = await cdp.send("Profiler.stop");
  await cdp.send("Profiler.disable");
  const nodes = new Map<number, ProfileNode>((p.nodes as ProfileNode[]).map((n) => [n.id, n]));
  const self = new Map<number, number>();
  const samples = p.samples ?? [];
  const deltas = p.timeDeltas ?? [];
  // Each sample's time is the delta to the next sample.
  for (let i = 0; i < samples.length; i++) {
    const id = samples[i];
    const dt = (deltas[i + 1] ?? 0) / 1000;
    if (id !== undefined) self.set(id, (self.get(id) ?? 0) + dt);
  }
  const byFrame = new Map<string, ProfileFrame>();
  let total = 0;
  for (const [id, ms] of self) {
    const frame = nodes.get(id)?.callFrame;
    if (!frame) continue;
    total += ms;
    const key = `${frame.url}:${frame.lineNumber}:${frame.columnNumber}:${frame.functionName}`;
    const seen = byFrame.get(key);
    byFrame.set(key, {
      url: frame.url,
      line: frame.lineNumber,
      column: frame.columnNumber,
      fn: frame.functionName,
      self: (seen?.self ?? 0) + ms,
    });
  }
  const frames = [...byFrame.values()].sort((a, b) => b.self - a.self).slice(0, 400);
  return { label, total, frames };
}
